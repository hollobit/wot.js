/**
 * Created by JoonHo Son on 2015. 11. 24..
 */

module.exports = function (config) {
    config.set({
        basePath: '',
        frameworks: ['mocha'],
        files: ['*Test.js'],
        exclude: [],
        reporters: ['progress'],
        port: 9876,
        colors: true,
        logLevel: config.LOG_INFO,
        autoWatch: false,
        browsers: [],
        plugins: [
            'karma-mocha'
        ]
    });
}