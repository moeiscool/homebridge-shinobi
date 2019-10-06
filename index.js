'use strict';

let Service, Characteristic, Accessory, hap, UUIDGen;


function CameraMotionPlatform(log, config) {
    this.log = log;
    this.config = config;

    if (!this.config) {
        return;
    }

    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
}


CameraMotionPlatform.prototype.accessories = function accessories(callback) {
    callback();
};


CameraMotionPlatform.prototype.didFinishLaunching = function didFinishLaunching() {
};


function ShinobiAccessory(log, config) {
    this.log = log;
}


module.exports = function Shinobi(homebridge) {

    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.platformAccessory;
    hap = homebridge.hap;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform('homebridge-shinobi', 'Shinobi', ShinobiPlatform, true);
    homebridge.registerAccessory('homebridge-shinobi', 'ShinobiMonitor', ShinobiAccessory);
};

