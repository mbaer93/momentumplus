// Stub for optional runtime modules that aren't published to npm.
// The Zoom Meeting SDK references @zoom/download-manager from code paths we
// never hit; both bundlers alias that import here so builds resolve.
module.exports = {};
