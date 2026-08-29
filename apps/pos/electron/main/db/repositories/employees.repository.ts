import bcrypt from 'bcryptjs';
import type { PosDatabase } from '../database';
import type { EmployeeRow } from '../types';

export class EmployeesRepository {
  constructor(private db: PosDatabase) {}

  findAllByBranch(branchId: string): EmployeeRow[] {
    return this.db.all<EmployeeRow>(
      'SELECT * FROM employees WHERE branch_id = ? ORDER BY created_at DESC',
      branchId
    );
  }

  findByPin(branchId: string, pin: string): EmployeeRow | null {
    // If no branchId is specified, search all employees (cross-branch global
    // PIN lookup). This matches the server-side loginWithPin flow and lets
    // the POS work without prompting the cashier to pick a branch first.
    const rows = branchId
      ? this.db.all<EmployeeRow>(
          'SELECT * FROM employees WHERE branch_id = ? AND is_active = 1 AND pin_hash IS NOT NULL',
          branchId
        )
      : this.db.all<EmployeeRow>(
          'SELECT * FROM employees WHERE is_active = 1 AND pin_hash IS NOT NULL'
        );
    for (const row of rows) {
      if (row.pin_hash && bcrypt.compareSync(pin, row.pin_hash)) {
        return row;
      }
    }
    return null;
  }

  countActive(branchId: string): number {
    const row = this.db.get<{ c: number }>(
      'SELECT COUNT(*) as c FROM employees WHERE branch_id = ? AND is_active = 1',
      branchId
    );
    return row?.c ?? 0;
  }

  upsertMany(rows: Partial<EmployeeRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO employees (
        id, user_id, restaurant_id, branch_id, first_name, last_name, email, phone, role, position_title,
        employee_number, pin_hash, is_active, joined_at, created_at, updated_at
      ) VALUES (
        @id, @user_id, @restaurant_id, @branch_id, @first_name, @last_name, @email, @phone, @role, @position_title,
        @employee_number, @pin_hash, @is_active, @joined_at,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        restaurant_id = excluded.restaurant_id,
        branch_id = excluded.branch_id,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        email = excluded.email,
        phone = excluded.phone,
        role = excluded.role,
        position_title = excluded.position_title,
        employee_number = excluded.employee_number,
        pin_hash = COALESCE(excluded.pin_hash, employees.pin_hash),
        is_active = excluded.is_active,
        joined_at = excluded.joined_at,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }

  update(employeeId: string, patch: Partial<EmployeeRow>): void {
    const fields = Object.keys(patch).filter((k) => k !== 'id');
    if (fields.length === 0) return;
    const sets = fields.map((f) => `${f} = @${f}`).join(', ');
    this.db.run(
      `UPDATE employees SET ${sets}, updated_at = unixepoch('now')*1000 WHERE id = @id`,
      { id: employeeId, ...patch }
    );
  }

  toggleActive(id: string): void {
    this.db.run(
      `UPDATE employees SET is_active = 1 - is_active, updated_at = unixepoch('now')*1000 WHERE id = ?`,
      id
    );
  }
}
