'use strict';

var connect = require('./sensorjs/index');
/**
 * Sensor.js init
 *
 * @type {*|exports|module.exports}
 * @global
 */
//var connect = require('../sensorjs/index');

/**
 * Sensor driver instance
 *
 * @global
 */
var sensorDriver = connect.sensor;

/**
 * Log4js
 *
 * @global
 */
var log4js = require('log4js');

/**
 * Lodash
 *
 * @global
 */
var _ = require('lodash');

/**
 * IP
 *
 * @global
 */
var ip = require('ip');

/**
 * Moment
 *
 * @global
 */
var moment = require('moment')();

/**
 * Request
 *
 * @global
 */
var request = require('request');

log4js.configure(__dirname + '/log4js_config.json');

/**
 * Log4js logger for 'WoT'
 *
 * @global
 */
var log = log4js.getLogger('WoT');
var app,
    sensors = {},
    sensorList = [];

/**
 * Default interval
 *
 * @type {number}
 * @global
 */
var RECOMMENDED_INTERVAL = 1000,
    /**
     * Default value array length
     *
     * @type {number}
     * @global
     */
    MAX_VALUES_LENGTH = 10;

// var wpxAddress = 'http://129.254.81.55:9090/wpx';
/**
 * WPx system url
 *
 * @type {string}
 * @global
 */
var wpxAddress = 'http://10.100.0.180:9090/wpx';

/**
 * Port number
 *
 * @global
 */
var port;

/**
 * Things array
 *
 * @type {Array}
 * @global
 */
var things = [];

/**
 * Resource array
 *
 * @type {Array}
 * @global
 */
var resources = [];

/**
 * Current thing id
 *
 * @global
 */
var currentThingId;

/**
 * Initialize WoT.js
 *
 * @param {String} thingId thing unique id.
 * @param  {http.Server}   appServer http.Server instance.
 * @param  {json}   options   initialize option.
 * @param  {Function} cb        callback function
 * @return {*}
 * @see {@link https://nodejs.org/api/http.html#http_http_createserver_requestlistener}
 * @public
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
 * Create sensor using <strong>sensorUrl</strong>
 *
 * @param {String} sensorUrl sensor url
 * @param {Function} cb callback function
 * @returns {*}
 * @public
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

/**
 * Discover sensors using driver name.
 *
 * @param  {String}   driverName driver name
 * @param  {Function} cb         callback function
 * @return {*}
 * @public
 * @deprecated
 */
function discoverSensors(driverName, cb) {
    sensorDriver.discover(driverName, function (err, devices) {
        log.info('[wot/discoverSensors] discovered devices', err, devices);
        return cb && cb(err, devices);
    });
}

/**
 * Set single actuator using sensor url
 *
 * @param {String} url sensor url
 * @param {Object} command command
 * @param {Object} options actuator option
 * @public
 */
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

/**
 * Set multiple actuators using network and model
 *
 * @param {String} network network
 * @param {String} model model
 * @param {Object} commands command
 * @param {Object} options option
 * @returns {boolean} result
 */
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

/**
 * Get sensor value by sensor id
 *
 * @param {String} id sensor id
 * @param {Function} callback callback
 */
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
 * Get sensor list of current thing.
 *
 * @param {Function} callback callback function
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

/**
 * Get thing by thing id
 *
 * @param {String} thingId thing id
 * @returns {*}
 */
function getThing(thingId) {
    // FIXME: array
    if (things[thingId]) {
        return things[thingId];
    }
}

/**
 * Add thing if current thing role of gateway
 *
 * @param {String} ip ip address
 * @param {String} port port number
 * @param {String} manufacturer manufacturer
 * @param {String} model model
 * @param {String} domain domain
 * @param {Array} appendResources addition resources
 * @param {Function} callback callback function
 */
function addThingWithIp(ip, port, manufacturer, model, domain, appendResources, callback) {
    addThingProcess(ip, port, manufacturer, model, domain, appendResources, callback);
}

/**
 * Add thing
 *
 * @param {String} manufacturer manufacturer
 * @param {String} model model
 * @param {String} domain domain
 * @param {Array} appendResources addition resources
 * @param {Function} callback callback function
 */
function addThing(manufacturer, model, domain, appendResources, callback) {
    addThingProcess(ip.address(), port, manufacturer, model, domain, appendResources, callback);
}

/**
 * Update thing status to TaaR system
 *
 * @param {Function} callback cabllback function
 */
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

/**
 * Delete thing from TaaR system
 *
 * @param {Function} callback callback function
 */
function deleteThing(callback) {
    var requestOption = {
        url: makeWPxUrl('/taar/' + currentThingId),
        method: 'delete'
    };

    request(requestOption, function (error, response, body) {
        log.debug(body);

        callback(response);
    });
}

/**
 * Send sensor data to TaaR System
 * @param {String} sensorId sensor id
 * @param {String} value value
 * @param {Function} callback callback function
 */
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

/**
 * @deprecated
 */
function updateSensorDatas(callback) {
    _.forEach(sensorList, function (v, k) {
        log.debug('sensor id >>> ', sensorList[k].id);
    });
}

/**
 * Make WPx registration uri
 *
 * @returns {String} URI
 */
function makeWPxOperationUri() {
    return '/wpx/raat/' + currentThingId;
}

//--------------------------------------------------------------
// private function
//--------------------------------------------------------------
/**
 * Make WPx accessible url
 *
 * @param {String} suffix uri suffix
 * @returns {string} URL
 * @private
 */
function makeWPxUrl(suffix) {
    var result = wpxAddress + suffix;

    log.debug('address : ', result);

    return result;
}

/**
 * Register sensor to thing
 *
 * @param {String} sensorUrl sensor url
 * @private
 */
function addSensorToResources(sensorUrl) {
    var parsedUrl = sensorDriver.parseSensorUrl(sensorUrl);
    var resourceData = checkTargetType(sensorUrl);

    resourceData.id = parsedUrl.id;

    resources.push(resourceData);
}

/**
 * Check sensor type
 *
 * @param {String} sensorUrl sensor url
 * @returns {Object} sensor information
 * @private
 */
function checkTargetType(sensorUrl) {
    var result = {};

    if (sensorUrl.toLowerCase().indexOf('ds18b20') != -1) {
        log.debug('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        log.debug('ds18b20');

        result.id = 'Temperature';
        result.type = "Sensor";
        result.category = "Temperature";
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
                "method": "POST",
                "uri": makeWPxOperationUri('temperature'),
                "out": [
                    "temperature"
                ]
            }
        ];
    } else if (sensorUrl.toLowerCase().indexOf('bh1750') != -1) {
        log.debug('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        log.debug('bh1750');

        result.id = 'DigitalLight'
        result.type = "Sensor";
        result.category = "DigitalLight";
        result.attributes = [
            {
                "name": "light",
                "description": "light",
                "type": "int",
                "unit": "lx",
                "min": "1",
                "max": "65535"
            }
        ];
        result.operations = [
            {
                "type": "getValue",
                "method": "POST",
                "uri": makeWPxOperationUri('light'),
                "out": [
                    "light"
                ]
            }
        ];
    } else if (sensorUrl.toLowerCase().indexOf('htu21d') != -1) {
        log.debug('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        log.debug('htu21d');

        result.id = 'Humidity';
        result.type = "Sensor";
        result.category = "Humidity";
        result.attributes = [
            {
                "name": "humidity",
                "description": "humidity",
                "type": "int",
                "unit": "percentage",
                "min": "0",
                "max": "100"
            }
        ];
        result.operations = [
            {
                "type": "getValue",
                "method": "POST",
                "uri": makeWPxOperationUri('humidity'),
                "out": [
                    "humidity"
                ]
            }
        ];
    } else if (sensorUrl.toLowerCase().indexOf('motion') != -1) {
        log.debug('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        log.debug('motion');

        result.id = 'Motion';
        result.type = "Sensor";
        result.category = "Motion";
        result.attributes = [
            {
                "name": "motion",
                "description": "motion",
                "type": "bool"
            }
        ];
        result.operations = [
            {
                "type": "getValue",
                "method": "POST",
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

/**
 * Get sensor value
 *
 * @param {String} sensorId sensor id
 * @param {*} value sensor value
 * @returns {Object} sensor value (e.g {name:value})
 * @private
 */
function getSensorValueToTaaR(sensorId, value) {
    var result = {};

    _.forEach(resources, function (o) {
        if (o.id === sensorId) {
            result[o.attributes[0].name] = value;
        }
    });

    return result;
}

/**
 * Process of register thing to TaaR system
 * @param {String} ip ip address
 * @param {String} port port number
 * @param {String} manufacturer manufacturer
 * @param {String} model model
 * @param {String} domain domain
 * @param {Array} appendResources addition things
 * @param {Function} callback callback function
 * @private
 */
function addThingProcess(ip, port, manufacturer, model, domain, appendResources, callback) {
    var requestOption = {
        url: makeWPxUrl('/taar'),
        method: 'post'
    };

    if (appendResources && appendResources.length > 0) {
        for (var i = 0; i < appendResources.length; i++) {
            resources.push(appendResources[i]);
        }
    }

    var imageUrl = '';

    if (manufacturer.toLowerCase() === 'intel') {
        imageUrl = 'https://docs.google.com/uc?id=0B02RRVY3KrmeMGVLQndNMzYzb1E';
    } else if (manufacturer.toLowerCase() === 'raspberry') {
        imageUrl = 'https://docs.google.com/uc?id=0B02RRVY3KrmedEpGSkJMWGR2TFE';
    } else {
        imageUrl = 'https://docs.google.com/uc?id=0B02RRVY3KrmeVkVldTJ2M1pvRUE';
    }

    var thingData = {
        "accessAddress": "http://" + ip + ":" + port + "/wotkit/" + currentThingId,
        "metadata": {
            "id": currentThingId,
            "types": [
                "Sensor",
                "Actuator"
            ],
            "createdTime": moment.format('YYYYMMDDhhmmss'),
            "expiredTime": moment.format('9999MMDDhhmmss'),
            "name": "Web Of Things",
            "manufacturer": manufacturer,
            "model": model,
            "domain": domain,
            "category": "home",
            "coordinates": {
                "longitude": "127.0978242",
                "latitude": "37.3949821",
                "altitude": "0"
            },
            "poi": "DasanTower/5F/Room1",
            "address": "Korea/Seoul/Gangnam-gu/Gangnam-daero/10-gil,109",
            "image": imageUrl,
            "owners": [
                "hollobit@etri.re.kr"
            ],
            "users": [
                "hollobit@etri.re.kr"
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
        log.debug('************************************************');
        log.debug(body);

        callback(response);
    });
}

exports.sensors = sensors;
exports.sensorList = sensorList;

exports.init = init;
exports.createSensor = createSensor;
exports.discoverSensors = discoverSensors;
exports.setActuator = setActuator;
exports.setActuators = setActuators;
exports.getSensorValue = getSensorValue;
exports.getThing = getThing;
exports.getThingList = getThingList;
exports.addThing = addThing;
exports.addThingWithIp = addThingWithIp;
exports.updateThing = updateThing;
exports.deleteThing = deleteThing;
exports.updateSensorData = updateSensorData;
exports.updateSensorDatas = updateSensorDatas;
exports.makeWPxOperationUri = makeWPxOperationUri;