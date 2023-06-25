/* eslint-disable no-case-declarations */

import ip from 'ip';
import fetch from 'node-fetch';
import { ChildProcess, spawn } from 'child_process';
import {
    CameraController,
    CameraStreamingDelegate,
    HAP,
    PlatformConfig,
    PrepareStreamCallback,
    PrepareStreamRequest,
    PrepareStreamResponse,
    SnapshotRequest,
    SnapshotRequestCallback,
    StreamingRequest,
    StreamRequestCallback,
    StreamRequestTypes,
    StreamSessionIdentifier,
    VideoInfo
} from 'homebridge';
import { ShinobiHomebridgePlatform } from './platform';
import { Monitor } from './shinobiMonitorAccessory';

type SessionInfo = {
    // address of the HAP controller
    address: string;

    videoPort: number;

    // key and salt concatenated
    videoSRTP: Buffer;

    // rtp synchronisation source
    videoSSRC: number;
}

/**
 * Shinobi Camera Streaming Delegate
 */
export class ShinobiStreamingDelegate implements CameraStreamingDelegate {

    public controller: CameraController | undefined;

    private readonly imageSource: string;
    private readonly videoSource: string;

    // keep track of sessions
    pendingSessions: Record<string, SessionInfo> = {};
    ongoingSessions: Record<string, ChildProcess> = {};

    constructor(
        private readonly platform: ShinobiHomebridgePlatform,
        private readonly hap: HAP,
        private readonly monitor: Monitor,
        public readonly config: PlatformConfig
    ) {

        let shinobiConfig = this.monitor.shinobiConfig;

        if (Array.isArray(shinobiConfig)) {
            shinobiConfig = this.monitor.shinobiConfig[0];
        }

        this.platform.log.info(`creating ShinobiStreamingDelegate using shinobi config: ${JSON.stringify(shinobiConfig)}`);

        this.imageSource = `${this.platform.config.shinobi_api}${shinobiConfig.snapshot}`;

        // default to shinobi video source...
        this.videoSource = `${this.platform.config.shinobi_api}${shinobiConfig.streams[0]}`;

        const monitorDetails = JSON.parse(shinobiConfig.details);

        // ...but prefer to connect directly to stream if possible
        if (this.monitor.useDynamicSubStream) {
            if (monitorDetails.substream && monitorDetails.substream.input && monitorDetails.substream.input.fulladdress) {
                this.videoSource = monitorDetails.substream.input.fulladdress;
                this.platform.log.info(`ShinobiStreamingDelegate using shinobi dynamic ' +
                    'substream direct camera source: ${this.videoSource}`);
            } else {
                this.platform.log.info(`ShinobiStreamingDelegate using shinobi dynamic substream proxy source: ${this.videoSource}`);
            }
        } else {
            if (monitorDetails.auto_host) {
                this.videoSource = monitorDetails.auto_host;
                this.platform.log.info(`ShinobiStreamingDelegate using direct camera source: ${this.videoSource}`);
            } else {
                this.platform.log.info(`ShinobiStreamingDelegate using shinobi proxy source: ${this.videoSource}`);
            }
        }
    }

    handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {

        this.platform.log.debug('handleSnapshotRequest: '
            + `${this.monitor.monitorConfig.monitor_id} => ${JSON.stringify(request)} from ${this.imageSource}`);

        fetch(this.imageSource)
            .then(res => res.buffer())
            .then(buffer => {
                this.platform.log.debug('handleSnapshotRequest() success');
                callback(undefined, buffer);
            })
            .catch(err => {
                this.platform.log.error(`handleSnapshotRequest() error: ${err.message}`);
                callback(err);
            });
    }

    // called when iOS requests rtp setup
    async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {

        this.platform.log.debug(`prepareStream: ${this.monitor.monitorConfig.monitor_id} => ${JSON.stringify(request)}`);

        await this.setRequiredSubStreamState();

        const sessionId: StreamSessionIdentifier = request.sessionID;
        const targetAddress = request.targetAddress;

        const video = request.video;
        const videoPort = video.port;

        const videoSrtpKey = video.srtp_key;
        const videoSrtpSalt = video.srtp_salt;

        const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

        const sessionInfo: SessionInfo = {
            address: targetAddress,

            videoPort: videoPort,
            videoSRTP: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
            videoSSRC: videoSSRC
        };

        const currentAddress = ip.address('public', request.addressVersion);
        const response: PrepareStreamResponse = {
            address: currentAddress,
            video: {
                port: videoPort,
                ssrc: videoSSRC,
                srtp_key: videoSrtpKey,
                srtp_salt: videoSrtpSalt
            }
        };

        this.pendingSessions[sessionId] = sessionInfo;
        this.platform.log.debug('prepareStream() success');
        callback(undefined, response);
    }

    // called when iOS device asks stream to start/stop/reconfigure
    async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {

        this.platform.log.debug(`handleStreamRequest: ${JSON.stringify(request)}`);

        const sessionId = request.sessionID;

        switch (request.type) {
            case StreamRequestTypes.START:
                const sessionInfo = this.pendingSessions[sessionId];

                if (!sessionInfo) {
                    const message = 'unknown sessionIdentifier: '
                        + `${this.monitor.monitorConfig.monitor_id} => ${sessionId} for start request!`;
                    this.platform.log.warn(message);
                    callback(new Error(message));
                    return;
                }

                const video: VideoInfo = request.video;

                const width = video.width;
                const height = video.height;
                const fps = video.fps;

                const payloadType = video.pt;
                const maxBitrate = video.max_bit_rate;
                const mtu = video.mtu;

                const address = sessionInfo.address;
                const videoPort = sessionInfo.videoPort;
                const ssrc = sessionInfo.videoSSRC;
                const videoSRTP = sessionInfo.videoSRTP.toString('base64');

                this.platform.log.debug(`requested video stream: ${width}x${height}, ${fps} fps, ${maxBitrate} kbps, ${mtu} mtu`);

                const ffmpegInputArgs = this.config.ffmpeg_input_args || '-fflags +genpts';
                const ffmpegProcessArgs = this.config.ffmpeg_process_args || '-vsync drop -vcodec copy -an';

                let ffmpegCommand = `${ffmpegInputArgs} -i ${this.videoSource} ${ffmpegProcessArgs} `
                    + `-f rtp -payload_type ${payloadType} -ssrc ${ssrc}`;

                ffmpegCommand += ` -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ${videoSRTP}`;

                ffmpegCommand += ` srtp://${address}:${videoPort}`
                    + `?rtcpport=${videoPort}&localrtcpport=${videoPort}&pkt_size=${mtu}`;

                this.platform.log.debug(ffmpegCommand);

                let started = false;

                const ffmpegProcess = spawn('ffmpeg', ffmpegCommand.split(' '), {env: process.env});

                ffmpegProcess.stderr.on('data', () => {
                    if (!started) {
                        started = true;
                        this.platform.log.debug('ffmpeg received first frame');

                        // do not forget to execute callback once set up
                        callback();
                    }
                });

                ffmpegProcess.on('error', error => {
                    this.platform.log.error(`failed to start video stream: ${error.message}`);
                    callback(new Error('ffmpeg process creation failed!'));
                });

                ffmpegProcess.on('exit', (code, signal) => {
                    const message = `ffmpeg exited with code: ${code} and signal: ${signal}`;

                    if (code === null || code === 255) {
                        this.platform.log.debug(`${message} (Video stream stopped!)`);
                    } else {
                        this.platform.log.error(`${message} (error)`);

                        if (!started) {
                            callback(new Error(message));
                        } else {
                            this.controller!.forceStopStreamingSession(sessionId);
                        }
                    }
                });

                this.ongoingSessions[sessionId] = ffmpegProcess;
                delete this.pendingSessions[sessionId];
                this.platform.log.debug('handleStreamRequest() START success');

                break;

            case StreamRequestTypes.RECONFIGURE:
                // not supported
                this.platform.log.warn(`received (unsupported) request to reconfigure to: ${JSON.stringify(request.video)}`);
                callback();
                break;

            case StreamRequestTypes.STOP:

                const existingFfmpegProcess = this.ongoingSessions[sessionId];

                if (!existingFfmpegProcess) {
                    const message = `unknown sessionIdentifier: ${this.monitor.monitorConfig.monitor_id} => ${sessionId} for stop request!`;
                    this.platform.log.warn(message);
                    callback(new Error(message));
                    return;
                }

                this.platform.log.debug(`killing: ${this.monitor.monitorConfig.monitor_id} `
                    + `=> ${sessionId} => PID: ${existingFfmpegProcess.pid}`);

                try {
                    if (existingFfmpegProcess) {
                        existingFfmpegProcess.kill('SIGKILL');
                    }
                } catch (e) {
                    this.platform.log.error('error occurred terminating the video process! ' + e);
                }

                delete this.ongoingSessions[sessionId];

                this.platform.log.debug('stopped streaming session!');

                await this.setRequiredSubStreamState();

                callback();
                break;
        }
    }

    // called when Homebridge is shutting down
    async shutdown(): Promise<void> {

        Object.keys(this.ongoingSessions).forEach((sessionId) => {

            const ffmpegProcess = this.ongoingSessions[sessionId];

            this.platform.log.debug(`killing: ${this.monitor.monitorConfig.monitor_id} => ${sessionId} => PID: ${ffmpegProcess.pid}`);

            try {
                if (ffmpegProcess) {
                    ffmpegProcess.kill('SIGKILL');
                }
            } catch (e) {
                this.platform.log.error('error occurred terminating the video process! ' + e);
            }
        });

        this.ongoingSessions = {};
        this.pendingSessions = {};

        await this.setRequiredSubStreamState();
    }

    shouldSubStreamBeActive(): boolean {
        const ongoingSessionsSessionsExist = (Object.keys(this.ongoingSessions).length > 0);
        const pendingSessionsExist = (Object.keys(this.pendingSessions).length > 0);
        return ongoingSessionsSessionsExist || pendingSessionsExist;
    }

    getSubStreamIsActive(): Promise<boolean> {
        const url = `${this.platform.config.shinobi_api}/${this.platform.config.api_key}/monitor/` +
            `${this.platform.config.group_key}/${this.monitor.monitorConfig.monitor_id}`;

        this.platform.log.debug(`fetching from Shinobi API: ${url}`);

        return fetch(url)
            .then(res => res.json())
            .then(shinobiConfig => {
                return shinobiConfig.subStreamActive;
            })
            .catch(err => {
                this.platform.log.error(`getSubStreamIsActive() error: ${err.message}`);
                throw err;
            });
    }

    toggleSubStreamActive(subStreamShouldBeActive): Promise<void> {
        const url = `${this.platform.config.shinobi_api}/${this.platform.config.api_key}/toggleSubstream/` +
            `${this.platform.config.group_key}/${this.monitor.monitorConfig.monitor_id}`;

        this.platform.log.debug(`fetching from Shinobi API: ${url}`);

        return fetch(url)
            .then(res => res.json())
            .then(shinobiResponse => {
                this.platform.log.debug(`substream toggle response: ${JSON.stringify(shinobiResponse)}`);
                if (shinobiResponse.ok !== subStreamShouldBeActive) {
                    throw Error(`Unable to set substream active state: ${subStreamShouldBeActive}, `+
                        `response: ${JSON.stringify(shinobiResponse)}`);
                }
            })
            .catch(err => {
                this.platform.log.error(`toggleSubStreamActive() error: ${err.message}`);
                throw err;
            });
    }

    // do nothing if sub-stream usage is not enabled, otherwise if at least one pending or in ongoing session exists
    // then ensure the sub-stream state in shinobi is active, otherwise ensure it is not active
    async setRequiredSubStreamState(): Promise<void> {
        if (!this.monitor.useDynamicSubStream) {
            return;
        }
        const subStreamShouldBeActive = this.shouldSubStreamBeActive();

        const subStreamIsActive = await this.getSubStreamIsActive();
        if (subStreamIsActive !== subStreamShouldBeActive) {
            await this.toggleSubStreamActive(subStreamShouldBeActive);
        }
    }
}
