'use strict';

let uuid, Service, Characteristic, StreamController;

const fetch = require('node-fetch');
const ip = require('ip');
const spawn = require('child_process').spawn;


function ShinobiCameraSource(hap, log, config, monitorConfig) {

    this.log = log;
    this.config = config;
    this.monitorConfig = monitorConfig;
    this.name = monitorConfig.name;

    uuid = hap.uuid;
    Service = hap.Service;
    Characteristic = hap.Characteristic;
    StreamController = hap.StreamController;

    this.imageSource = `${this.config.shinobiApi}${this.monitorConfig.snapshot}`;

    // default to shinobi video source...
    this.videoSource = `${this.config.shinobiApi}${this.monitorConfig.streams[0]}`;

    // ...but prefer to connect directly to stream if possible
    const details = JSON.parse(this.monitorConfig.details);

    if (details.auto_host) {
        this.log('ShinobiCameraSource() using direct camera source');
        this.videoSource = details.auto_host;
    }
    this.services = [];
    this.streamControllers = [];

    this.pendingSessions = {};
    this.ongoingSessions = {};

    this.services.push(new Service.CameraControl());

    const options = {
        proxy: false,
        srtp: true, // Supports SRTP AES_CM_128_HMAC_SHA1_80 encryption
        video: {
            resolutions: [
                [640, 360, 20]
            ],
            codec: {
                profiles: [2], // Enum, please refer StreamController.VideoCodecParamProfileIDTypes
                levels: [0, 1, 2] // Enum, please refer StreamController.VideoCodecParamLevelTypes
            }
        },
        audio: {
            codecs: [
                {
                    type: "AAC-eld",
                    samplerate: 16
                }
            ]
        }
    };

    this.createStreamControllers(2, options);
}


ShinobiCameraSource.prototype.handleCloseConnection = function(connectionID) {

    this.log(`handleCloseConnection: ${this.name} => ${connectionID}`);

    this.streamControllers.forEach((controller) => {
        controller.handleCloseConnection(connectionID);
    });
};


ShinobiCameraSource.prototype.handleSnapshotRequest = function handleSnapshotRequest(request, callback) {

    this.log(`handleSnapshotRequest: ${this.name} => ${JSON.stringify(request)} from ${this.imageSource}`);

    fetch(this.imageSource)
        .then(res => callback(undefined, res.buffer()))
        .catch(err => {
            this.log(`ShinobiCameraSource.handleSnapshotRequest() error: ${err.message}`);
            callback(err);
        });
};


ShinobiCameraSource.prototype.prepareStream = function(request, callback) {

    this.log(`prepareStream: ${this.name} => ${JSON.stringify(request)}`);

    const sessionID = request.sessionID;
    const sessionIdentifier = uuid.unparse(sessionID);
    const targetAddress = request.targetAddress;

    const videoTargetPort = request.video.port;
    const videoSrtpKey = request.video.srtp_key;
    const videoSrtpSalt = request.video.srtp_salt;
    const videoSsrc = 1;

    const audioTargetPort = request.audio.port;
    const audioSrtpKey = request.audio.srtp_key;
    const audioSrtpSalt = request.audio.srtp_salt;
    const audioSsrc = 1;

    this.pendingSessions[sessionIdentifier] = {
        address: targetAddress,
        port: videoTargetPort,
        srtp: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
        ssrc: videoSsrc
    };

    const sourceAddress = ip.address();

    const response = {
        address: {
            address: sourceAddress,
            type: 'v4'
        },
        video: {
            port: videoTargetPort,
            srtp_key: videoSrtpKey,
            srtp_salt: videoSrtpSalt,
            ssrc: videoSsrc
        },
        audio: {
            port: audioTargetPort,
            srtp_key: audioSrtpKey,
            srtp_salt: audioSrtpSalt,
            ssrc: audioSsrc
        }
    };

    callback(response);
};


ShinobiCameraSource.prototype.handleStreamRequest = function handleStreamRequest(request) {

    this.log(`handleStreamRequest: ${JSON.stringify(request)}`);

    const requestType = request.type;
    const sessionIdentifier = uuid.unparse(request.sessionID);

    if (requestType === 'start') {

        const sessionInfo = this.pendingSessions[sessionIdentifier];

        if (!sessionInfo) {
            this.log(`Unknown sessionIdentifier: ${this.name} => ${sessionIdentifier} for start request!`);
            return;
        }

        const targetAddress = sessionInfo.address;
        const targetPort = sessionInfo.port;
        const srtp = sessionInfo.srtp;
        const ssrc = sessionInfo.ssrc;

        const pt = request.video.pt;
        const mtu = request.video.mtu;

        let ffmpegCommand = '-i ' + this.videoSource + ' -vsync drop -vcodec copy -an -f rtp -payload_type ' + pt +
            ' -ssrc ' + ssrc +
            ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ' + srtp.toString("base64")  +
            ' srtp://' + targetAddress + ':' + targetPort + '?rtcpport=' + targetPort +
            '&localrtcpport=' + targetPort + '&pkt_size=' + mtu;

        this.log(ffmpegCommand);

        const ffmpegProcess = spawn('ffmpeg', ffmpegCommand.split(' '), {env: process.env});

        ffmpegProcess.stdout.pipe(process.stdout);

        this.ongoingSessions[sessionIdentifier] = ffmpegProcess;

        delete this.pendingSessions[sessionIdentifier];
    }
    else if (requestType === 'stop') {

        const ffmpegProcess = this.ongoingSessions[sessionIdentifier];

        if (!ffmpegProcess) {
            this.log(`Unknown sessionIdentifier: ${this.name} => ${sessionIdentifier} for stop request!`);
            return;
        }

        this.log(`Killing: ${this.name} => ${sessionIdentifier} => PID: ${ffmpegProcess.pid}`);
        ffmpegProcess.kill('SIGKILL');
        this.log(`Killed PID: ${ffmpegProcess.pid}`);

        delete this.ongoingSessions[sessionIdentifier];
    }
};


ShinobiCameraSource.prototype.createStreamControllers = function createStreamControllers(maxStreams, options) {

    let self = this;

    for (let i = 0; i < maxStreams; i++) {

        const streamController = new StreamController(i, options, self);

        self.streamControllers.push(streamController);
        self.services.push(streamController.service);
    }
};

ShinobiCameraSource.prototype.shutdown = function shutdown() {

    Object.keys(this.ongoingSessions).forEach((sessionIdentifier) => {

        const ffmpegProcess = this.ongoingSessions[sessionIdentifier];

        this.log(`Killing: ${this.name} => ${sessionIdentifier} => PID: ${ffmpegProcess.pid}`);
        ffmpegProcess.kill('SIGKILL');
        this.log(`Killed PID: ${ffmpegProcess.pid}`);
    });

    this.ongoingSessions = [];
};


module.exports = {
    ShinobiCameraSource
};
