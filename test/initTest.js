/**
 * Created by JoonHo Son on 2015. 11. 23..
 */
'use strict';

var http = require('http');
var wot = require('../wot');
var express = require('express');
var app = express();
var server = http.createServer(app);
var netProfile;
var WPx_THING_ID = 'init_test_thing_id';

describe('Array', function () {
    describe('Wot.js#init', function () {
        var options = {
            websocketTopic: 'sensorData',
            reportInterval: netProfile && netProfile.reportingPeriod
        };

        wot.init(WPx_THING_ID, server, options, function () {
        });
    });
});
