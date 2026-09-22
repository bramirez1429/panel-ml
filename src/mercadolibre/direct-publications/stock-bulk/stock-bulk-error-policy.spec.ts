import { HttpException, UnauthorizedException } from '@nestjs/common';

import { StockBulkErrorPolicy } from './stock-bulk-error-policy';

describe('StockBulkErrorPolicy', () => {
  const policy = new StockBulkErrorPolicy();

  it('aplica backoff a 429, timeout y 5xx', () => {
    expect(policy.decide(new HttpException('rate limit', 429), 1)).toEqual({
      action: 'RETRY',
      delaySeconds: 5,
      message: 'rate limit',
    });
    expect(policy.decide(new HttpException('timeout', 504), 2)).toEqual({
      action: 'RETRY',
      delaySeconds: 15,
      message: 'timeout',
    });
    expect(policy.decide(new HttpException('provider', 502), 3)).toEqual({
      action: 'RETRY',
      delaySeconds: 60,
      message: 'provider',
    });
  });

  it('detiene el job ante 401 sin intentar reconectar', () => {
    expect(
      policy.decide(new UnauthorizedException('token inv\u00e1lido'), 1),
    ).toEqual({
      action: 'STOP',
      message: 'token inv\u00e1lido',
    });
  });
});
