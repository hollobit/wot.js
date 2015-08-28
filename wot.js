'use strict';

var connect = require('sensorjs'),
    sensorDriver = connect.sensor,
    logger = require('log4js').getLogger('WoT'),
    _ = require('lodash');

var app,
    sensors = {};

var RECOMMENDED_INTERVAL = 60 * 1000,
    MAX_VALUES_LENGTH = 100;

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

        logger.info('sensors', sensors);

        next();
      }).
      use(connect.filter({$between: [-50, 1000]})). // filter: passing between -50 and 50
//      use(connect.average(25 /*duration*/)).     // reduce: values to an average every 20 sec.
//      use(function (data, next) {                // custom middleware
//        if (Math.max.apply(null, data.queue) < data.value) {
//          console.log('new record', data.value);
//        }
//        next();
//      }).
//      use(connect.queue(2)).                   // buffering max # of 100.
      use('/w1/*/ds18b20', function (data, next) {
        logger.info('[wot/use] ds18b20 temperature', data.value);
        next();
      }).
      use('/i2c/*/BH1750', function (data, next) {
        logger.info('[wot/use] BH1750 light', data.value);
        next();
      }).
      // transport(mqtt, localStorage, websocket and etc)
      //use(connect.websocket('http://yourhost.com', 'temperature/{id}'/*topic*/));
      use(connect.websocketServer(appServer, options && options.websocketTopic));

  return cb && cb();
}

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
      interval: sensorProperties && sensorProperties.recommendedInterval || RECOMMENDED_INTERVAL
    };

    app.listen(sensor);

    logger.info('[wot/createSensor] sensor is created', sensorId, sensors);

    return cb && cb(null, sensor)
  } catch (e) {
    logger.error('[wot/createSensor] sensor is not created', sensorUrl, e);
    return cb && cb(e);
  }
}

function discoverSensors(driverName, cb) {
  sensorDriver.discover(driverName, function (err, devices) {
    logger.info('[wot/discoverSensors] discovered devices', err, devices);
    return cb && cb(err, devices);
  });
}

exports.sensors = sensors;

exports.init = init;
exports.createSensor = createSensor;
exports.discoverSensors = discoverSensors;