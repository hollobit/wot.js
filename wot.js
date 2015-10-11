'use strict';

// var connect = require('sensorjs');
var connect = require('../sensorjs/index');
var sensorDriver = connect.sensor;
var log4js = require('log4js');
var _ = require('lodash');
var ip = require('ip');
var moment = require('moment')();

log4js.configure(__dirname + '/log4js_config.json');

var log = log4js.getLogger('WoT');
var app,
    sensors = {},
    sensorList = [];

var RECOMMENDED_INTERVAL = 1000,
        MAX_VALUES_LENGTH = 10;

var wpxAddress = 'http://129.254.81.55:9090/wpx';
var request = require('request');
var port;
var things = [];
var resources = [];
var currentThingId;

/**
 * Initialize WoT.js
 * 
 * @param  {http.Server}   appServer http.Server instance.
 * @param  {[type]}   options   [description]
 * @param  {Function} cb        [description]
 * @return {[type]}             [description]
 * @see {@link https://nodejs.org/api/http.html#http_http_createserver_requestlistener}
 */
function init(thingId, appServer, options, cb) {
    currentThingId = thingId;
    port = appServer._events.request.get('port')
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

        addSensorToResources(sensorUrl);

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

function setActuator(url, command, options) {
    if (!url || !command) {
        throw new Error('SensorUrl and command can not be null.');
    }

    var actuator = sensorDriver.createSensor(url);

    log.info('Set actuator - ', url, command, options);

    actuator.set(command, options, function (error, result) {
        if (_.isObject(options) && options.duration) {
            setTimeout(function () {
                log.info('Actuator clearing after ', options.duration);
                actuator.clear();
                actuator = null;
            }, options.duration);
        } else {
            log.info('Actuator clearing now.');
            actuator.clear();
            actuator = null;
        }
    });
}

function setActuators(network, model, commands, options) {
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
                    log.info('Actuator clearing after ', options.duration);
                    actuator.clear();
                    actuator = null;
                }, options.duration);
            } else {
                log.info('Actuator clearing now.');
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

/**
 * [getThingList description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 * @deprecated
 */
function getThingList(callback) {
    var requestOption = {
        url: makeWPxUrl('/taar'),
        method: 'get'
    };

    request(requestOption, function (error, response, body) {
        callback(response);
    });
}

function getThing(thingId) {
    // FIXME: array
    if (things[thingId]) {
        return things[thingId];
    }
}

function addThing(callback) {
    var requestOption = {
        url: makeWPxUrl('/taar'),
        method: 'post'
    };

    // temp
    var cameraData = {
        "id": "pi-camera",
        "type": "Actuator",
        "category": "Camera",
        "attributes": [
            {
                "name": "receiver",
                "description": "receiver email address",
                "type": "string",
                "unit": "",
                "min": "",
                "max": ""
            }
        ],
        "operations": [
            {
                "type": "setState",
                "method": "POST",
                "uri": makeWPxOperationUri('camera'),
                "in": [
                    "capture"
                ],
                "out": [
                    "capture"
                ]
            }
        ]
    };

    resources.push(cameraData);

    var thingData = {
        "accessAddress": "http://" + ip.address() + ":" + port + "/wotkit",
        "metadata": {
            "id": currentThingId,
            "types": [
                "Sensor",
                "Actuator"
            ],
            "createdTime": moment.format('YYYYMMDDhhmmss'),
            "expiredTime": moment.format('9999MMDDhhmmss'),
            "name": "Web Of Things",
            "manufacturer": "Raspberry",
            "model": "Raspberry Pi 2 B",
            "domain": "House",
            "category": "",
            "coordinates": {
                "longitude": "127.0978242",
                "latitude": "37.3949821",
                "altitude": "0"
            },
            "poi": "DasanTower/5F/Room1",
            "address": "Korea/Seoul/Gangnam-gu/Gangnam-daero,10-gil,109",
            "image": "http://192.168.11.100/coweb-imgservice/images/insight-switch.jpg",
            "owners": [
                  "hosung.lee@etri.re.kr",
                  "junux@handysoft.co.kr"
            ],
            "users": [
              "hosung.lee@etri.re.kr",
              "junux@handysoft.co.kr"
            ],
            "keywords": [
              "demo",
              "test",
              "wot"
            ],
            "cpu": "unknown",
            "memory": "unknown",
            "disk": "unknown",
            "version": "1.0",
            "resources": resources
        }
    };

    things[currentThingId] = thingData; // FIXME: arguments thingId

    log.debug('send data-------------------------');
    log.debug(JSON.stringify(thingData));

    requestOption.json = thingData;

    request(requestOption, function (error, response, body) {
        log.debug(body);

        callback(response);
    });
}

function updateThing(callback) {
    var thingData = things[currentThingId];

    var requestOption = {
        url: makeWPxUrl('/taar/' + currentThingId),
        method: 'put',
        json: thingData
    };

    request(requestOption, function (error, response, body) {
        log.debug(body);

        callback(response);
    });
}

function deleteThing(callback) {
    var thingData = things[currentThingId];

    var requestOption = {
        url: makeWPxUrl('/taar/' + currentThingId),
        method: 'delete'
    };

    request(requestOption, function (error, response, body) {
        log.debug(body);

        callback(response);
    });
}

function updateSensorData(sensorId, value, callback) {
    var requestOption = {
        url: makeWPxUrl('/taar/' + currentThingId + '/' + sensorId),
        method: 'post',
        json: {
            "time": moment.format('YYYYMMDDhhmmss'),
            "value": getSensorValueToTaaR(sensorId, value)
        }
    };

    request(requestOption, function (error, response, body) {
        log.debug(body);

        callback(response);
    });
}

function updateSensorDatas(callback) {
    _.forEach(sensorList, function (v, k) {
        log.debug('sensor id >>> ', sensorList[k].id);
    });
}

//--------------------------------------------------------------
// private function
//--------------------------------------------------------------
function makeWPxUrl(suffix) {
    var result = wpxAddress + suffix;

    log.debug('address : ', result);

    return result;
}

function makeWPxOperationUri(target) {
    var result = '/wpx/raat/' + currentThingId + '/' + target;

    return result;
}

function addSensorToResources(sensorUrl) {
    var parsedUrl = sensorDriver.parseSensorUrl(sensorUrl);
    var resourceData = checkTargetType(sensorUrl);

    resourceData.id = parsedUrl.id;

    resources.push(resourceData);
}

function checkTargetType(sensorUrl) {
    var result = {};

    if (sensorUrl.toLowerCase().indexOf('ds18b20') != -1) {
        log.debug('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        log.debug('ds18b20');

        result.type = "Sensor";
        result.category = "Humidity";
        result.attributes = [
            {
                "name": "temperature",
                "description": "temperature",
                "type": "float",
                "unit": "degree",
                "min": "-45.0",
                "max": "125"
            }
        ];
        result.operations = [
            {
                "type": "getValue",
                "method": "GET",
                "uri": makeWPxOperationUri('temperature'),
                "out": [
                    "temperature"
                ]
            }
        ];
    } else if (sensorUrl.toLowerCase().indexOf('bh1750') != -1) {
        log.debug('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        log.debug('bh1750');

        result.type = "Sensor";
        result.category = "DigitalLight";
        result.attributes = [
            {
                "name": "light",
                "description": "light",
                "type": "float",
                "unit": "lx",
                "min": "1",
                "max": "65535"
            }
        ];
        result.operations = [
            {
                "type": "getValue",
                "method": "GET",
                "uri": makeWPxOperationUri('light'),
                "out": [
                    "light"
                ]
            }
        ];
    } else if (sensorUrl.toLowerCase().indexOf('htu21d') != -1) {
        log.debug('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        log.debug('htu21d');
        result.type = "Sensor";
        result.category = "Humidity";
        result.attributes = [
            {
                "name": "humidity",
                "description": "humidity",
                "type": "float",
                "unit": "percentage",
                "min": "0",
                "max": "100"
            }
        ];
        result.operations = [
            {
                "type": "getValue",
                "method": "GET",
                "uri": makeWPxOperationUri('humidity'),
                "out": [
                    "humidity"
                ]
            }
        ];
    } else if (sensorUrl.toLowerCase().indexOf('motion') != -1) {
        log.debug('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        log.debug('motion');
        result.type = "Sensor";
        result.category = "Motion";
        result.attributes = [
            {
                "name": "motion",
                "description": "motion",
                "type": "bool",
                "unit": "",
                "min": "",
                "max": ""
            }
        ];
        result.operations = [
            {
                "type": "getValue",
                "method": "GET",
                "uri": makeWPxOperationUri('motion'),
                "out": [
                    "motion"
                ]
            }
        ];
    } else {
        // TODO: hue
    }

    return result;
}

function getSensorValueToTaaR(sensorId, value) {
    var result = {};

    _.forEach(resources, function (o) {
        if (o.id === sensorId) {
            result[o.attributes[0].name] = value;
        }
    });

    return result;
}

exports.sensors = sensors;
exports.sensorList = sensorList;

exports.init = init;
exports.createSensor = createSensor;
exports.discoverSensors = discoverSensors;
exports.setActuator = setActuator;
exports.setActuators = setActuators;
exports.getSensorValue = getSensorValue;
exports.getThingList = getThingList;
exports.addThing = addThing;
exports.updateThing = updateThing;
exports.deleteThing = deleteThing;
exports.updateSensorData = updateSensorData;
exports.updateSensorDatas = updateSensorDatas;