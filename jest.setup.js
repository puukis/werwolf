const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });

const { window } = dom;

function copyProps(source, target) {
  Object.getOwnPropertyNames(source).forEach(prop => {
    if (typeof target[prop] === 'undefined') {
      const descriptor = Object.getOwnPropertyDescriptor(source, prop);
      Object.defineProperty(target, prop, descriptor);
    }
  });
}

global.window = window;
global.document = window.document;
global.navigator = {
  userAgent: 'node.js',
  platform: 'node.js',
  language: 'en-US',
  languages: ['en-US']
};
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.localStorage = window.localStorage;
global.sessionStorage = window.sessionStorage;

global.requestAnimationFrame = window.requestAnimationFrame || function (cb) {
  return setTimeout(cb, 0);
};

global.cancelAnimationFrame = window.cancelAnimationFrame || function (id) {
  clearTimeout(id);
};

if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  });
}

global.matchMedia = window.matchMedia.bind(window);

global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.EventTarget = window.EventTarget;

copyProps(window, global);
