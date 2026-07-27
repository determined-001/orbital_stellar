import { DemoEmitter, WellKnown } from './generated';

export default function App() {
  console.log(DemoEmitter.ping());
  console.log(WellKnown.info());
  return null;
}
