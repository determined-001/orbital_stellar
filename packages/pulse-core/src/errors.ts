export class EngineAlreadyStartedError extends Error {
  constructor() {
    super("[pulse-core] EventEngine.start() called while the SSE stream is already active.");
    this.name = "EngineAlreadyStartedError";
  }
}
