// tests/arm-direct.test.ts
import { describe, expect, it } from 'vitest';
import { Arm } from '../src/arm';
import { InProcTransport } from '../src/transport';
import { commandTopic, rpcTopic } from '../src/protocol';
import { decodeRequest, encodeReply } from '../src/codec';

describe('Arm direct MIT', () => {
  it('sendMit publishes a mit frame to command topic', async () => {
    const tp = new InProcTransport();
    const sub = await tp.sub(commandTopic('armA'));
    const arm = new Arm({ transport: tp, armId: 'armA' });
    await arm.connect();
    await arm.sendMit([15] * 7, [2] * 7, [0.1] * 7, [0] * 7, [0] * 7);
    const payload = sub.tryRecv();
    expect(payload).toBeDefined();
    const frame = JSON.parse(new TextDecoder().decode(payload!));
    expect(frame.type).toBe('mit');
    expect(frame.client_id).toBeTruthy();
    expect(frame.kp).toEqual([15] * 7);
  });

  it('setGuards calls rpc set_guards', async () => {
    const tp = new InProcTransport();
    tp.declareQueryable(rpcTopic('armA'), (payload) => {
      const req = decodeRequest(payload);
      expect(req.method).toBe('set_guards');
      return encodeReply(true, null);
    });
    const arm = new Arm({ transport: tp, armId: 'armA' });
    await arm.connect();
    await arm.setGuards({ slewLimit: 0.5 });
  });
});
