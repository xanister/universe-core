import '@testing-library/jest-dom/vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock ResizeObserver (required by Radix UI components)
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;

// Mock IntersectionObserver (required by useLazyBackgroundImage)
class IntersectionObserverMock {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.IntersectionObserver =
  IntersectionObserverMock as unknown as typeof IntersectionObserver;

// Mock pointer capture APIs (required by Radix UI)
Object.defineProperty(Element.prototype, 'hasPointerCapture', {
  value: () => false,
  writable: true,
  configurable: true,
});
Object.defineProperty(Element.prototype, 'setPointerCapture', {
  value: () => {},
  writable: true,
  configurable: true,
});
Object.defineProperty(Element.prototype, 'releasePointerCapture', {
  value: () => {},
  writable: true,
  configurable: true,
});
