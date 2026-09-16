import { DigitalEmployeeUpdateDtoSchema } from './index';

describe('employee avatar binding input', () => {
  it.each(['/assets/employees/silicon/frontend-engineer.webp', 'https://images.example.com/custom.webp?signature=abc'])('accepts a platform path or custom HTTP(S) URL: %s', (avatar) => {
    expect(DigitalEmployeeUpdateDtoSchema.parse({ avatar }).avatar).toBe(avatar);
  });

  it.each(['//example.com/a.webp', '/assets/../secret.webp', 'javascript:alert(1)', 'ftp://example.com/a.webp', 'https://user:password@example.com/a.webp'])('rejects invalid bindings: %s', (avatar) => {
    expect(DigitalEmployeeUpdateDtoSchema.safeParse({ avatar }).success).toBe(false);
  });
});
