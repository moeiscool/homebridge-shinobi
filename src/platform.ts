import fs from 'fs';
import https from 'https';
import fetch from 'node-fetch';
import express from 'express';

import {
    API,
    APIEvent,
    DynamicPlatformPlugin,
    Logger,
    PlatformAccessory,
    PlatformConfig,
    Service,
    Characteristic
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { ShinobiMonitorAccessory, Monitor } from './shinobiMonitorAccessory';

/**
 * ShinobiHomebridgePlatform
 */
export class ShinobiHomebridgePlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service = this.api.hap.Service;
    public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

    // this is used to track restored cached accessories
    public readonly existingAccessories: PlatformAccessory[] = [];

    // this is used to have a reference to monitor accessory handles to listen for homebridge shutdown
    // and to update state on shinobi webhook callbacks
    private monitorsByMonitorId = new Map<string, ShinobiMonitorAccessory>();

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API
    ) {
        log.debug('finished initializing platform');

        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            log.debug('executing didFinishLaunching callback');

            this.createMonitors()
                .then(() => {
                    log.debug('monitors created');
                }).catch((err) => {
                    log.error(`failed to create monitors: ${err.message}`);
                });
            this.startWebhookListener();
        });

        api.on(APIEvent.SHUTDOWN, () => {
            log.debug('executed shutdown callback');
            this.shutdown();
        });
    }

    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: PlatformAccessory) {
        this.log.info(`loading accessory from cache: ${accessory.displayName}`);

        // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.existingAccessories.push(accessory);
    }

    /**
     * This queries shinobi and uses config to determine which monitor accessories to create.
     */
    async createMonitors() {

        for (let i = 0; i < this.config.monitors.length; i++) {

            const monitorConfig = this.config.monitors[i];
            const url = `${this.config.shinobi_api}/${this.config.api_key}/monitor/${this.config.group_key}/${monitorConfig.monitor_id}`;

            this.log.debug(`fetching from Shinobi API: ${url}`);

            fetch(url)
                .then(res => res.json())
                .then(shinobiConfig => {
                    return {
                        displayName: `${monitorConfig.monitor_id} monitor`,
                        useSubStream: monitorConfig.use_substream === true,
                        monitorConfig,
                        shinobiConfig
                    } as Monitor;
                })
                .then((monitor: Monitor) => {
                    this.createMonitor(monitor);
                })
                .catch(err => {
                    this.log.error(err);
                    this.log.error(`didFinishLaunching() error: ${err.message}`);
                });
        }
    }

    createMonitor(monitor: Monitor) {
        this.log.debug('createMonitor()');

        const monitorId = monitor.monitorConfig.monitor_id;

        this.log.debug(`processing monitor: ${monitorId}`);

        const uuid = this.api.hap.uuid.generate(`${this.config.group_key}-${monitorId}`);

        // see if an accessory with the same uuid has already been registered and restored from
        // the cached devices we stored in the `configureAccessory` method above
        const existingAccessory = this.existingAccessories.find(accessory => accessory.UUID === uuid);
        if (existingAccessory) {
            // the accessory already exists
            this.log.info(`found existing accessory for UUID: ${uuid} => ${existingAccessory.displayName}`);

            // create the accessory handler for the restored accessory
            this.monitorsByMonitorId.set(monitorId, new ShinobiMonitorAccessory(this, existingAccessory, monitor, this.config));

        } else {
            // the accessory does not yet exist, so we need to create it
            this.log.info(`adding new accessory: ${monitor.displayName}`);

            // create a new accessory
            const accessory = new this.api.platformAccessory(monitor.displayName, uuid);

            // create the accessory handler for the newly created accessory
            this.monitorsByMonitorId.set(monitorId, new ShinobiMonitorAccessory(this, accessory, monitor, this.config));

            // link the accessory to your platform
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
    }

    startWebhookListener() {

        const app = express();

        app.get('/', (request, response) => {

            const monitorId = request.query.mid;
            const group = request.query.group;

            this.log.debug(`shinobi motion webhook: group = ${group}, monitorId = ${monitorId}`);

            const monitor = this.monitorsByMonitorId.get(monitorId);

            if ((this.config.group_key === group) && monitor) {

                monitor.setMotionDetected(true);

                response.sendStatus(200);
            } else {
                response.sendStatus(400);
            }

        });

        if (this.config.https_key_path && this.config.https_cert_path) {
            const options = {
                key: fs.readFileSync(this.config.https_key_path),
                cert: fs.readFileSync(this.config.https_cert_path)
            };
            https.createServer(options, app).listen(this.config.web_hook_port);
            this.log.info(`started HTTPS server for ${PLATFORM_NAME} webhooks on port '${this.config.web_hook_port}'`);
        } else {
            app.listen(this.config.web_hook_port);
            this.log.info(`started HTTP server for ${PLATFORM_NAME} webhooks on port '${this.config.web_hook_port}'`);
        }
    }

    shutdown() {
        this.monitorsByMonitorId.forEach((monitorAccessory) => {
            monitorAccessory.shutdown();
        });
    }
}
