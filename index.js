'use strict';

const fetch = require('node-fetch');
const fs = require('fs');
const https = require('https');
const express = require('express');

const ShinobiCameraSource = require('./shinobi_camera_source').ShinobiCameraSource;

let Service, Characteristic, Accessory, hap, UUIDGen;


function ShinobiPlatform(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    if (!this.config) {
        return;
    }

    this.cameraSources = [];
    this.cameraAccessories = [];
    this.motionAccessories = [];

    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    this.api.on('shutdown', this.shutdown.bind(this));
}


ShinobiPlatform.prototype.accessories = function accessories(callback) {

    const accessories = [];

    for (let i = 0; i < this.config.monitors.length; i++) {

        const monitorConfig = this.config.monitors[i];

        const accessory = new ShinobiMonitorAccessory(this.log, monitorConfig);

        this.motionAccessories[monitorConfig.shinobi_id] = accessory;
        accessories.push(accessory);
    }

    callback(accessories);
};


ShinobiPlatform.prototype.didFinishLaunching = function didFinishLaunching() {

    const promises = [];

    for (let i = 0; i < this.config.monitors.length; i++) {

        const monitorConfig = this.config.monitors[i];
        const url = `${this.config.shinobi_api}/${this.config.api_key}/monitor/${this.config.group_key}/${monitorConfig.shinobi_id}`;

        const promise = fetch(url)
            .then(res => res.json())
            .then(shinobiMonitorConfig => {

                const uuid = UUIDGen.generate(monitorConfig.display_name);

                const cameraAccessory = new Accessory(monitorConfig.display_name, uuid, hap.Accessory.Categories.CAMERA);
                const cameraAccessoryInfo = cameraAccessory.getService(Service.AccessoryInformation);
                cameraAccessoryInfo.setCharacteristic(Characteristic.Manufacturer, 'homebridge-shinobi');
                cameraAccessoryInfo.setCharacteristic(Characteristic.Model, 'shinobi');

                const cameraSource = new ShinobiCameraSource(hap, this.log, this.config, monitorConfig, shinobiMonitorConfig);

                cameraAccessory.configureCameraSource(cameraSource);

                this.cameraAccessories[monitorConfig.shinobi_id] = cameraAccessory;
                this.cameraSources[monitorConfig.shinobi_id] = cameraSource;

                this.log(`ShinobiPlatform.didFinishLaunching() added camera ${monitorConfig.display_name} for monitor ID: ${monitorConfig.shinobi_id}`);
            })
            .catch(err => {
                this.log(`ShinobiPlatform.didFinishLaunching() error: ${err.message}`);
            });

        promises.push(promise);
    }

    Promise.all(promises).then(() => {
        this.api.publishCameraAccessories('homebridge-shinobi', this.cameraAccessories);
        this.log('Camera accessories published');
    })
    .catch(err => {
        this.log(`ShinobiPlatform.didFinishLaunching() error: ${err.message}`);
    });

    const app = express();

    app.get('/', (function(request, response) {

        const monitorId = request.query.mid;
        const group = request.query.group;

        this.log(`Shinobi motion webhook: group = ${group}, monitorId = ${monitorId}`);

        if ((this.config.group_key === group) && this.motionAccessories[monitorId]) {

            const motionAccessory = this.motionAccessories[monitorId];

            motionAccessory.setMotion(true);

            setTimeout(motionAccessory.setMotion.bind(motionAccessory), 1000, false);

            response.sendStatus(200);
        }
        else {
            response.sendStatus(400);
        }

    }).bind(this));

    if (this.config.https_key_path && this.config.https_cert_path) {
        const options = {
            key: fs.readFileSync(this.config.https_key_path),
            cert: fs.readFileSync(this.config.https_cert_path)
        };
        https.createServer(options, app).listen(this.config.web_hook_port);
        this.log(`Started HTTPS server for homebridge-shinobi webhooks on port '${this.config.web_hook_port}'`);
    }
    else {
        app.listen(this.config.web_hook_port);
        this.log(`Started HTTP server for homebridge-shinobi webhooks on port '${this.config.web_hook_port}'`);
    }
};


ShinobiPlatform.prototype.shutdown = function shutdown() {

    for (let i = 0; i < this.config.monitors.length; i++) {

        const monitorConfig = this.config.monitors[i];

        if (this.cameraSources[monitorConfig.shinobi_id]) {
            this.cameraSources[monitorConfig.shinobi_id].shutdown();
        }
    }
};


function ShinobiMonitorAccessory(log, monitorConfig) {

    this.log = log;
    this.monitorId = monitorConfig.shinobi_id;
    this.name = `${monitorConfig.display_name} motion`;

    this.motionService = new Service.MotionSensor(this.name);

    this.setMotion(false);
}


ShinobiMonitorAccessory.prototype.setMotion = function setMotion(detected) {

    this.log(`motion: ${this.monitorId} => ${detected}`);

    this.motionService.getCharacteristic(Characteristic.MotionDetected).setValue(detected);
};


ShinobiMonitorAccessory.prototype.getServices = function getServices() {

    return [this.motionService];
};


module.exports = function Shinobi(homebridge) {

    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.platformAccessory;
    hap = homebridge.hap;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform('homebridge-shinobi', 'Shinobi', ShinobiPlatform, true);
    homebridge.registerAccessory('homebridge-shinobi', 'ShinobiMonitor', ShinobiMonitorAccessory);
};

