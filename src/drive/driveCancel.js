let currentController = new AbortController();

function getSignal() {
  return currentController.signal;
}

function cancel() {
  currentController.abort();
  currentController = new AbortController();
}

module.exports = { getSignal, cancel };
