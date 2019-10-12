'use strict';

const fetch = require('node-fetch');
const fs = require('fs');
const https = require('https');
const express = require('express');

const ShinobiCameraSource = require('./shinobi_camera_source').ShinobiCameraSource;

let Service, Characteristic, Accessory, hap, UUIDGen;


function ShinobiPlatform(log, config) {
    this.log = log;
    this.config = config;

    this.cameraSources = [];
    this.cameraAccessories = [];
    this.motionAccessories = [];

    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    this.api.on('shutdown', this.shutdown.bind(this));
}


ShinobiPlatform.prototype.accessories = function accessories(callback) {

    for (let i = 0; i < this.config.monitors.length; i++) {

        const monitorId = this.config.monitors[i];

        this.motionAccessories[monitorId] = new ShinobiMonitorAccessory(this.log, monitorId);
    }

    callback(this.motionAccessories);

    const app = express();

    app.get('/', (function(request, response) {

        const monitorId = request.query.mid;
        const group = request.query.group;

        this.log(`Shinobi motion webhook: group = ${group}, monitorId = ${monitorId}`);

        if ((this.config.groupKey === group) && this.motionAccessories[monitorId]) {

            const motionAccessory = this.motionAccessories[monitorId];

            motionAccessory.setMotion(true);

            setTimeout(motionAccessory.setMotion.bind(motionAccessory), 1000, false);

            response.sendStatus(200);
        }
        else {
            response.sendStatus(400);
        }

    }).bind(this));

    if (this.config.httpsKeyPath && this.config.httpsCertPath) {
        const options = {
            key: fs.readFileSync(this.config.httpsKeyPath),
            cert: fs.readFileSync(this.config.httpsCertPath)
        };
        https.createServer(options, app).listen(this.web_hook_port);
        this.log(`Started HTTPS server for homebridge-shinobi webhooks on port ${this.web_hook_port}`);
    }
    else {
        app.listen(this.config.web_hook_port);
        this.log(`Started HTTP server for homebridge-shinobi webhooks on port ${this.web_hook_port}`);
    }
};


ShinobiPlatform.prototype.didFinishLaunching = function didFinishLaunching() {

    const promises = [];

    for (let i = 0; i < this.config.monitors.length; i++) {

        const monitorId = this.config.monitors[i];
        const url = `${this.config.shinobiApi}/${this.config.apiKey}/monitor/${this.config.groupKey}/${monitorId}`;

        const promise = fetch(url)
            .then(res => res.json())
            .then(monitorConfig => {

                const uuid = UUIDGen.generate(monitorId);

                const cameraAccessory = new Accessory(monitorId, uuid, hap.Accessory.Categories.CAMERA);

                const cameraSource = new ShinobiCameraSource(hap, this.log, this.config, monitorConfig);

                cameraAccessory.configureCameraSource(cameraSource);

                this.cameraAccessories[monitorId] = cameraAccessory;
                this.cameraSources[monitorId] = cameraSource;
            })
            .catch(err => {
                this.log(`ShinobiPlatform.didFinishLaunching() error: ${err.message}`);
            });

        promise.push(promise);
    }

    Promise.all(promises).then(() => {
        this.api.publishCameraAccessories('Shinobi', cameraAccessories);
    })
    .catch(err => {
        this.log(`ShinobiPlatform.didFinishLaunching() error: ${err.message}`);
    });
};


ShinobiPlatform.prototype.shutdown = function shutdown() {

    for (let i = 0; i < this.config.monitors.length; i++) {

        const monitorId = this.config.monitors[i];

        if (this.cameraSources[monitorId]) {
            this.cameraSources[monitorId].shutdown();
        }
    }
};


function ShinobiMonitorAccessory(log, monitorId) {

    this.log = log;
    this.monitorId = monitorId;

    this.motionService = new Service.MotionSensor(this.monitorId);

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

