'use strict';

var connect = require('sensorjs');
var sensorDriver = connect.sensor;
var log4js = require('log4js');
var _ = require('lodash');

log4js.configure(__dirname + '/log4js_config.json');

var log = log4js.getLogger('WoT');
var app,
    sensors = {},
    sensorList = [];

var RECOMMENDED_INTERVAL = 1000,
        MAX_VALUES_LENGTH = 10;

/**
 * Initialize WoT.js
 * 
 * @param  {http.Server}   appServer http.Server instance.
 * @param  {[type]}   options   [description]
 * @param  {Function} cb        [description]
 * @return {[type]}             [description]
 * @see {@link https://nodejs.org/api/http.html#http_http_createserver_requestlistener}
 */
function init(appServer, options, cb) {
    app = connect().
    use(function (data, next) {
        if (data && data.id && _.isObject(sensors[data.id])) {
            sensors[data.id].latest = data.value;
            sensors[data.id].status = data.status;
            sensors[data.id].time = data.time;
            sensors[data.id].type = data.type;
            sensors[data.id].message = data.message;

            if (_.isArray(sensors[data.id].values)) {
                if (sensors[data.id].values.length < MAX_VALUES_LENGTH) {
                    sensors[data.id].values.push([data.time, data.value]);
                } else {
                    sensors[data.id].values.shift();
                    sensors[data.id].values.push([data.time, data.value]);
                }
            }
        }

        log.info('sensors', sensors);

        next();
    }).
    use(connect.filter({$between: [-50, 1000]})).
    use('/w1/*/ds18b20', function (data, next) {
        log.info('[wot/use] ds18b20 temperature', data.value);
        next();
    }).
    use('/i2c/*/BH1750', function (data, next) {
        log.info('[wot/use] BH1750 light', data.value);
        next();
    }).
    // transport(mqtt, localStorage, websocket and etc)
    //use(connect.websocket('http://yourhost.com', 'temperature/{id}'/*topic*/));
    use(connect.websocketServer(appServer, options && options.websocketTopic));

    return cb && cb();
}

/**
 * Create sensor using url
 * 
 * @param  {String}   sensorUrl sensorjs:///
 * @param  {Function} cb        [description]
 * @return {[type]}             [description]
 */
function createSensor(sensorUrl, cb) {
    var sensor,
        sensorId,
        parsedSensorUrl,
        sensorProperties;

    try {
        sensor = sensorDriver.createSensor(sensorUrl);
        parsedSensorUrl = sensorDriver.parseSensorUrl(sensorUrl);
        sensorId = parsedSensorUrl.id;
        sensorProperties = sensorDriver.getSensorProperties(parsedSensorUrl.model);

        sensors[sensorId] = {
            sensor: sensor, // instance
            url: sensorUrl,
            values: [],
            latest: null,
            status: null,
            time: null,
            type: null,
            message: null,
            interval: RECOMMENDED_INTERVAL || sensorProperties && sensorProperties.recommendedInterval
            // interval: sensorProperties && sensorProperties.recommendedInterval || RECOMMENDED_INTERVAL
        };

        app.listen(sensor);

        // sensorList.push(sensor);
        sensorList[sensorId] = sensor;

        log.info('[wot/createSensor] sensor is created', sensorId, sensors);

        return cb && cb(null, sensor);
    } catch (e) {
        log.error('[wot/createSensor] sensor is not created', sensorUrl, e);
        return cb && cb(e);
    }
}

function discoverSensors(driverName, cb) {
    sensorDriver.discover(driverName, function (err, devices) {
        log.info('[wot/discoverSensors] discovered devices', err, devices);
        return cb && cb(err, devices);
    });
}

function setActurator(url, command, options) {
    if (!url || !command) {
        throw new Error('SensorUrl and command can not be null.');
    }

    var actuator = sensorDriver.createSensor(url);

    log.info('Set actuator - ', url, command, options);

    actuator.set(command, options, function (error, result) {
        if (_.isObject(options) && options.duration) {
            setTimeout(function () {
                log.info('Acturator clearing after ', options.duration);
                actuator.clear();
                actuator = null;
            }, options.duration);
        } else {
            log.info('Acturator clearing now.');
            actuator.clear();
            actuator = null;
        }
    });
}

function setActurators(network, model, commands, options) {
    if (!network || !model || !commands) {
        throw new Error('Network, sensor model and commands can not be null.');
    }

    _.forEach(commands, function (command) {
        var url = 'sensorjs:///' + network + '/' + command.pin + '/' + model + '/' + model + '-' + command.pin;
        var actuator = sensorDriver.createSensor(url);

        log.info('Set actuator - ', url, command.command, options);

        actuator.set(command.command, options, function (error, result) {
            if (_.isObject(options) && options.duration) {
                setTimeout(function () {
                    log.info('Acturator clearing after ', options.duration);
                    actuator.clear();
                    actuator = null;
                }, options.duration);
            } else {
                log.info('Acturator clearing now.');
                actuator.clear();
                actuator = null;
            }
        });
    });

    return true;
}

function getSensorValue(id, callback) {
    if (!id) {
        throw new Error('ID required!');
    }

    if (!sensors[id]) {
        throw new Error('[' + id + '] does not exist!');
    }

    if (!callback) {
        throw new Error('Callback required!');
    }

    this.sensorList[id].getValue(null, callback);
}

exports.sensors = sensors;
exports.sensorList = sensorList;

exports.init = init;
exports.createSensor = createSensor;
exports.discoverSensors = discoverSensors;
exports.setActurator = setActurator;
exports.setActurators = setActurators;
exports.getSensorValue = getSensorValue;