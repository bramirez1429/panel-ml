import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';

describe('Auth DTOs', () => {
  it('normaliza el email y acepta un registro válido', async () => {
    const input = plainToInstance(RegisterDto, {
      email: '  USER@Example.COM ',
      password: 'a-secure-password',
      name: 'User',
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input.email).toBe('user@example.com');
  });

  it.each([
    ['password corto', { email: 'user@example.com', password: 'short' }],
    [
      'nombre en blanco',
      {
        email: 'user@example.com',
        password: 'a-secure-password',
        name: '   ',
      },
    ],
  ])('rechaza un registro con %s', async (_case, value) => {
    const errors = await validate(plainToInstance(RegisterDto, value));

    expect(errors).not.toHaveLength(0);
  });

  it('normaliza un login y permite passwords existentes de cualquier longitud', async () => {
    const input = plainToInstance(LoginDto, {
      email: ' USER@Example.COM ',
      password: 'x',
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input.email).toBe('user@example.com');
  });

  it('rechaza un login con email inválido', async () => {
    const input = plainToInstance(LoginDto, {
      email: 'not-an-email',
      password: 'a-password',
    });

    await expect(validate(input)).resolves.not.toHaveLength(0);
  });
});
