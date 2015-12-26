'use strict';

// NOTE: sensorjs-ble is required (npm install sensorjs-ble)
var connect = require('../'),
   sensorApp = connect.sensor,
   bleSensor = require('sensorjs-ble'),
   ble;
   
sensorApp.addSensorPackage(bleSensor);
ble = sensorApp.getNetwork('ble');

var app = connect().
  use(connect.filter({$between: [-50, 50]})). // filter: passing between -50 and 50
  use(connect.average(20 /*duration*/)).      // reduce: values to an average every 5 sec.
  use(function (data, next) {                // custom middleware
    if (Math.max.apply(null, data.queue) < data.value) {
      console.log('new record', data.value);
    } 
    next();
  }).
  use(connect.queue(100));                   // buffering max # of 100.
  // transport(mqtt, localStorage, websocket and etc)
  //use(connect.websocket('http://yourhost.com', 'temperature/{id}'/*topic*/));

ble.discover('sensorTagHum'/* sensor driver name(or profile name) */, function (err, devices) {
  devices.forEach(function (device) {
    device.sensorUrls.forEach(function (sensorUrl) {
      app.listen(sensorApp.createSensor(sensorUrl));
    });
  });
});
