import { DemoEmitter, WellKnown } from './generated';

export function anchorLogic() {
  console.log(DemoEmitter.ping());
  console.log(WellKnown.info());
}
