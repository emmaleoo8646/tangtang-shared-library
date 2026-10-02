import { detectCoverBounds, type DetectionPixels } from "./coverDetection";

self.onmessage = (event: MessageEvent<DetectionPixels>) => {
  self.postMessage(detectCoverBounds(event.data));
};
