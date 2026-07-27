import { DemoEmitter, WellKnown } from './generated';

export function start() {
  console.log(DemoEmitter.ping());
  console.log(WellKnown.info());
}
