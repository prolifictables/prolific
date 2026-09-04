import type { PosDatabase } from '../database';
import type { TableRow, CustomerRow } from '../types';

export class TablesRepository {
  constructor(private db: PosDatabase) {}

  list(branchId: string, filters?: { status?: string; zone?: string }): TableRow[] {
    const clauses: string[] = ['branch_id = ?'];
    const params: unknown[] = [branchId];
    if (filters?.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.zone) {
      clauses.push('zone = ?');
      params.push(filters.zone);
    }
    return this.db.all<TableRow>(
      `SELECT * FROM tables WHERE ${clauses.join(' AND ')} ORDER BY name ASC`,
      ...params
    );
  }

  upsertMany(rows: Partial<TableRow>[]): void {
    if (rows.length === 0) return;
    // Incoming rows come from one of two sources — each uses a different
    // naming convention, so we normalize to SQLite's snake_case columns here:
    //   (1) POS-side local creation: already snake_case.
    //   (2) Cloud sync / pull-worker from Mongo: camelCase from Mongoose
    //       .lean() (id, branchId, name, zone, capacity, status, qrCodeId,
    //       permanentQrId, restaurantId, createdAt, updatedAt).
    // After normalization we also keep both forms on the row object so any
    // downstream consumer is unaffected.
    const normalized = rows.map((raw) => {
      const r: any = { ...(raw as any) };
      r.id = String(r.id ?? r._id ?? '');
      r.branch_id = r.branch_id ?? r.branchId ?? null;
      r.restaurant_id = r.restaurant_id ?? r.restaurantId ?? null;
      r.name = r.name ?? null;
      r.zone = r.zone ?? null;
      r.capacity = typeof r.capacity === 'number' ? r.capacity : null;
      r.status = r.status ?? 'AVAILABLE';
      r.qr_code_id = r.qr_code_id ?? r.qrCodeId ?? null;
      r.permanent_qr_id = r.permanent_qr_id ?? r.permanentQrId ?? null;
      r.created_at = typeof r.created_at === 'number' ? r.created_at
        : (typeof r.createdAt === 'number' ? r.createdAt
        : (r.createdAt instanceof Date ? r.createdAt.getTime() : Date.now()));
      r.updated_at = typeof r.updated_at === 'number' ? r.updated_at
        : (typeof r.updatedAt === 'number' ? r.updatedAt
        : (r.updatedAt instanceof Date ? r.updatedAt.getTime() : Date.now()));
      return r as Partial<TableRow>;
    });
    const stmt = this.db['prepare'](`
      INSERT INTO tables (
        id, branch_id, restaurant_id, name, zone, capacity, status,
        qr_code_id, permanent_qr_id, created_at, updated_at
      ) VALUES (
        @id, @branch_id, @restaurant_id, @name, @zone, @capacity, @status,
        @qr_code_id, @permanent_qr_id,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id,
        restaurant_id = excluded.restaurant_id,
        name = excluded.name,
        zone = excluded.zone,
        capacity = excluded.capacity,
        status = excluded.status,
        qr_code_id = excluded.qr_code_id,
        permanent_qr_id = excluded.permanent_qr_id,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of normalized) stmt.run(row as any);
    })();
  }

  updateStatus(id: string, status: string): void {
    this.db.run(
      `UPDATE tables SET status = ?, updated_at = unixepoch('now')*1000 WHERE id = ?`,
      status,
      id
    );
  }
}

export class CustomersRepository {
  constructor(private db: PosDatabase) {}

  list(branchId: string, limit = 50, cursor?: string): CustomerRow[] {
    const clauses: string[] = ['branch_id = ?'];
    const params: unknown[] = [branchId];
    if (cursor) {
      clauses.push('id < ?');
      params.push(cursor);
    }
    return this.db.all<CustomerRow>(
      `SELECT * FROM customers WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      ...params,
      limit
    );
  }

  findOrCreate(
    branchId: string,
    data: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      phone?: string | null;
    }
  ): CustomerRow {
    let match: CustomerRow | undefined;
    if (data.phone) {
      match = this.db.get<CustomerRow>(
        'SELECT * FROM customers WHERE branch_id = ? AND phone = ?',
        branchId,
        data.phone
      );
    }
    if (!match && data.email) {
      match = this.db.get<CustomerRow>(
        'SELECT * FROM customers WHERE branch_id = ? AND email = ?',
        branchId,
        data.email
      );
    }
    if (match) return match;

    const id = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    this.db.run(
      `INSERT INTO customers (
        id, restaurant_id, branch_id, first_name, last_name, email, phone,
        address, loyalty_level, total_visits, total_spent_cents, note,
        created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, NULL, ?, ?)`,
      id,
      branchId,
      data.first_name ?? null,
      data.last_name ?? null,
      data.email ?? null,
      data.phone ?? null,
      now,
      now
    );
    return this.db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', id)!;
  }

  upsertMany(rows: Partial<CustomerRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO customers (
        id, restaurant_id, branch_id, first_name, last_name, email, phone,
        address, loyalty_level, total_visits, total_spent_cents, note,
        created_at, updated_at
      ) VALUES (
        @id, @restaurant_id, @branch_id, @first_name, @last_name, @email, @phone,
        @address, @loyalty_level, @total_visits, @total_spent_cents, @note,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        restaurant_id = excluded.restaurant_id,
        branch_id = excluded.branch_id,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        email = excluded.email,
        phone = excluded.phone,
        address = excluded.address,
        loyalty_level = excluded.loyalty_level,
        total_visits = excluded.total_visits,
        total_spent_cents = excluded.total_spent_cents,
        note = excluded.note,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }

  update(id: string, patch: Partial<CustomerRow>): void {
    const fields = Object.keys(patch).filter((k) => k !== 'id');
    if (fields.length === 0) return;
    const sets = fields.map((f) => `${f} = @${f}`).join(', ');
    this.db.run(
      `UPDATE customers SET ${sets}, updated_at = unixepoch('now')*1000 WHERE id = @id`,
      { id, ...patch }
    );
  }
}
