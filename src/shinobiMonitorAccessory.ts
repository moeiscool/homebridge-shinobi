import {
    CameraControllerOptions,
    CharacteristicGetCallback,
    H264Level,
    H264Profile,
    HAP,
    PlatformAccessory,
    Service,
    SRTPCryptoSuites
} from 'homebridge';
import { ShinobiHomebridgePlatform } from './platform';
import { ShinobiStreamingDelegate } from './shinobiStreamingDelegate';

export type Monitor = {
    displayName: string;
    monitorConfig: {
        monitor_id: string;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shinobiConfig: any;
}

/**
 * Shinobi Monitor Accessory
 */
export class ShinobiMonitorAccessory {
    public readonly hap: HAP = this.platform.api.hap;
    private motionService: Service;
    private readonly shinobiStreamingDelegate: ShinobiStreamingDelegate;
    private motionDetected = false;

    constructor(
        private readonly platform: ShinobiHomebridgePlatform,
        private readonly accessory: PlatformAccessory,
        private readonly monitor: Monitor
    ) {

        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
            .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

        // get the MotionSensor service if it exists, otherwise create a new MotionSensor service
        this.motionService = this.accessory.getService(this.platform.Service.MotionSensor)
            || this.accessory.addService(this.platform.Service.MotionSensor);

        // set the service name, this is what is displayed as the default name on the Home app
        this.motionService.setCharacteristic(this.platform.Characteristic.Name,
            `${this.monitor.monitorConfig.monitor_id} motion`);

        // register handler for the Motion Characteristic
        this.motionService.getCharacteristic(this.platform.Characteristic.MotionDetected)
            .on('get', this.getMotionDetected.bind(this));

        this.shinobiStreamingDelegate = new ShinobiStreamingDelegate(this.platform, this.hap, this.monitor);

        const options: CameraControllerOptions = {
            cameraStreamCount: 2,
            delegate: this.shinobiStreamingDelegate,

            streamingOptions: {
                srtp: true,
                proxy: false,
                supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
                video: {
                    codec: {
                        profiles: [H264Profile.MAIN],
                        levels: [H264Level.LEVEL4_0]
                    },
                    resolutions: [
                        [640, 360, 20]
                    ]
                }
            }
        };

        const cameraController = new this.hap.CameraController(options);
        this.shinobiStreamingDelegate.controller = cameraController;

        accessory.configureController(cameraController);
    }

    /**
     * Handle the "GET" requests from HomeKit
     * These are sent when HomeKit wants to know the current state of the accessory.
     */
    getMotionDetected(callback: CharacteristicGetCallback) {

        this.platform.log.debug(`getMotionDetected() -> ${this.motionDetected}`);

        callback(null, this.motionDetected);
    }

    /**
     * Handle update from shinobi webhook
     */
    setMotionDetected(detected: boolean) {

        this.motionDetected = detected;

        // push the new value to HomeKit
        this.motionService.updateCharacteristic(this.platform.Characteristic.MotionDetected, this.motionDetected);

        this.platform.log.debug(`pushed updated current MotionDetected state to HomeKit: ${this.motionDetected}`);

        // reset motion state after one second
        if (detected) {
            setTimeout(() => {
                this.setMotionDetected(false);
            }, 1000);
        }
    }

    /**
     * Handle homebridge shutdown
     */
    shutdown() {
        this.shinobiStreamingDelegate.shutdown();
    }
}
