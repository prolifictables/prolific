'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { apiGet, apiPatch } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface BranchSettingsState {
  receiptHeader: string;
  receiptFooter: string;
  receiptSubHeader?: string;
  autoPrintEnabled: boolean;
  autoPrintOrderStatus: string[];
  kitchenPrintEnabled: boolean;
  defaultTaxId: string;
  includeTaxInPrices: boolean;
  defaultTipPercent: number;
  allowCustomTip: boolean;
  tipPresets: number[];
  kitchenStations: string[];
  serviceChargePercent: number;
  serviceChargeEnabled: boolean;
  enableOnlineOrdering: boolean;
  enableQROrdering: boolean;
  orderAcceptanceTimeoutMinutes: number;
  autoPrintCopies: number;
  logoUrl: string;
  restaurantName: string;
  phonePrimary: string;
  phoneSecondary: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateRegion: string;
  postCode: string;
  country: string;
  vatRegNumber: string;
  openTime: string;
  closeTime: string;
  currency: string;
  timezone: string;
  language: string;
}

const DEFAULT: BranchSettingsState = {
  receiptHeader: 'Thank you for dining with us!',
  receiptFooter: 'Please come again.\nKeep your receipt for returns & exchanges.\nPowered by Prolific POS',
  autoPrintEnabled: true,
  autoPrintOrderStatus: ['NEW', 'PREPARING', 'READY'],
  kitchenPrintEnabled: true,
  defaultTaxId: '',
  includeTaxInPrices: true,
  defaultTipPercent: 0,
  allowCustomTip: true,
  tipPresets: [5, 10, 15],
  kitchenStations: [
    'Grill Station',
    'Fry Station',
    'Cold Prep',
    'Pantry / Salads',
    'Pastry & Desserts',
    'Bar / Beverages',
    'Pasta Station',
    'Expediter Pass',
  ],
  serviceChargePercent: 0,
  serviceChargeEnabled: false,
  enableOnlineOrdering: true,
  enableQROrdering: true,
  orderAcceptanceTimeoutMinutes: 3,
  autoPrintCopies: 1,
  logoUrl: '',
  restaurantName: 'Prolific Tables',
  phonePrimary: '+234 800 000 0000',
  phoneSecondary: '',
  addressLine1: '123 Aba Road',
  addressLine2: 'GRA Phase 3',
  city: 'Port Harcourt',
  stateRegion: 'Rivers State',
  postCode: '500001',
  country: 'Nigeria',
  vatRegNumber: 'RC - 0000000',
  openTime: '08:00',
  closeTime: '23:00',
  currency: 'NGN',
  timezone: 'Africa/Lagos',
  language: 'en',
};

export default function BranchSettingsPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<'receipt' | 'pricing' | 'kitchen' | 'orders' | 'branch'>('receipt');
  const [form, setForm] = useState<BranchSettingsState>(DEFAULT);
  const [taxes, setTaxes] = useState<{ id: string; name: string; rate: number; isIncludedInPrice?: boolean; isActive?: boolean }[]>([]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      if (!branch?.id) throw new Error('Select a branch to manage settings');
      const [sett, tList]: any = await Promise.all([
        apiGet(`/settings?branchId=${encodeURIComponent(branch.id)}`),
        apiGet(`/taxes?branchId=${encodeURIComponent(branch.id)}&includeInactive=true`),
      ]);
      setForm({ ...DEFAULT, ...(sett?.data || sett || {}) });
      setTaxes(Array.isArray(tList?.data) ? tList.data : Array.isArray(tList) ? tList : []);
    } catch (err: any) {
      toast('Failed to load settings', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSettings(); }, [branch?.id]);

  const save = async () => {
    setSaving(true);
    try {
      if (!branch?.id) throw new Error('Select a branch to save settings');
      await apiPatch(`/settings?branchId=${encodeURIComponent(branch.id)}`, form);
      toast('Settings saved successfully', { variant: 'success' });
    } catch (err: any) {
      toast(err.message, { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const stationsStr = form.kitchenStations.join('\n');
  const setStations = (val: string) => {
    const list = val.split('\n').map((s) => s.trim()).filter(Boolean);
    setForm({ ...form, kitchenStations: list });
  };

  const presetsStr = form.tipPresets.join(', ');
  const setPresets = (val: string) => {
    const list = val.split(',').map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n) && n >= 0);
    setForm({ ...form, tipPresets: list });
  };

  const sections = [
    { id: 'branch', label: 'Branch Details', icon: '🏢' },
    { id: 'receipt', label: 'Receipt & Printing', icon: '🧾' },
    { id: 'pricing', label: 'Pricing, Tax & Tipping', icon: '₦' },
    { id: 'kitchen', label: 'Kitchen Stations', icon: '👨\u200d🍳' },
    { id: 'orders', label: 'Ordering Workflow', icon: '📋' },
  ] as const;

  const SectionHeader = ({ title, description, badge }: { title: string; description?: string; badge?: string }) => (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
      </div>
      {badge && <Badge variant="soft">{badge}</Badge>}
    </div>
  );

  const ToggleRow = ({
    label, description, value, onChange,
  }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-slate-900 text-sm">{label}</div>
        {description && <div className="text-xs text-slate-500 mt-0.5">{description}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
          value ? 'bg-brand-600' : 'bg-slate-200'
        )}
        style={{ marginRight: 2 }}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform',
            value ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Badge variant="brand">Branch Settings</Badge>
            <span>·</span>
            <span>{branch?.name || 'Global'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-1.5">Branch Configuration</h1>
          <p className="text-sm text-slate-500 mt-1">Receipts, taxes, kitchen stations, and operational defaults</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchSettings} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1"><path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Reload
          </Button>
          <Button loading={saving || loading} onClick={save}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <aside className="lg:sticky lg:top-4 h-fit">
          <Card className="!p-2 space-y-1">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id as any)}
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2.5',
                  activeSection === s.id
                    ? 'bg-brand-50 text-brand-700 shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                <span className="text-base w-5 text-center">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </Card>
        </aside>

        <div className="space-y-4 min-w-0">
          {activeSection === 'branch' && (
            <Card>
              <CardHeader padded>
                <CardTitle>
                  <SectionHeader
                    title="Branch Information"
                    description="Identifying details and contact information shown on receipts and public pages"
                    badge={branch?.city || branch?.id ? `Branch ID: ${branch?.id || 'N/A'}` : undefined}
                  />
                </CardTitle>
              </CardHeader>
              <div className="px-5 pb-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input label="Restaurant / Branch Name" value={form.restaurantName} onChange={(e) => setForm({ ...form, restaurantName: e.target.value })} placeholder="Prolific Tables" />
                  <Input label="Logo URL (optional)" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://..." />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input label="Primary Phone" value={form.phonePrimary} onChange={(e) => setForm({ ...form, phonePrimary: e.target.value })} />
                  <Input label="Secondary Phone" value={form.phoneSecondary} onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })} />
                </div>
                <Input label="Address Line 1" value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
                <Input label="Address Line 2" value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  <Input label="State / Region" value={form.stateRegion} onChange={(e) => setForm({ ...form, stateRegion: e.target.value })} />
                  <Input label="Post Code" value={form.postCode} onChange={(e) => setForm({ ...form, postCode: e.target.value })} />
                  <Input label="Country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input label="VAT / Business Reg. No." value={form.vatRegNumber} onChange={(e) => setForm({ ...form, vatRegNumber: e.target.value })} />
                  <Input label="Open Time" type="time" value={form.openTime} onChange={(e) => setForm({ ...form, openTime: e.target.value })} />
                  <Input label="Close Time" type="time" value={form.closeTime} onChange={(e) => setForm({ ...form, closeTime: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Select
                    label="Currency"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    options={[
                      { value: 'NGN', label: 'Nigerian Naira (₦, NGN)' },
                      { value: 'GHS', label: 'Ghanaian Cedi (GHS)' },
                      { value: 'KES', label: 'Kenyan Shilling (KES)' },
                      { value: 'ZAR', label: 'South African Rand (ZAR)' },
                      { value: 'USD', label: 'US Dollar ($, USD)' },
                      { value: 'GBP', label: 'British Pound (£, GBP)' },
                    ]}
                  />
                  <Select
                    label="Timezone"
                    value={form.timezone}
                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    options={[
                      { value: 'Africa/Lagos', label: 'West Africa (Lagos) UTC+1' },
                      { value: 'Africa/Accra', label: 'Ghana (Accra) UTC±0' },
                      { value: 'Africa/Nairobi', label: 'East Africa (Nairobi) UTC+3' },
                      { value: 'Africa/Johannesburg', label: 'Southern Africa (SAST) UTC+2' },
                      { value: 'UTC', label: 'UTC (Coordinated)' },
                    ]}
                  />
                  <Select
                    label="UI Language"
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'fr', label: 'Français' },
                      { value: 'yo', label: 'Yoruba' },
                      { value: 'ha', label: 'Hausa' },
                      { value: 'ig', label: 'Igbo' },
                    ]}
                  />
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'receipt' && (
            <div className="space-y-4">
              <Card>
                <CardHeader padded>
                  <CardTitle>
                    <SectionHeader title="Receipt Content" description="Text displayed at the top and bottom of every customer receipt (80mm thermal or A4)" badge={`${form.receiptHeader.length + form.receiptFooter.length} chars`} />
                  </CardTitle>
                </CardHeader>
                <div className="px-5 pb-5 space-y-4">
                  <Textarea
                    label="Receipt Header"
                    rows={3}
                    value={form.receiptHeader}
                    onChange={(e) => setForm({ ...form, receiptHeader: e.target.value })}
                    placeholder="Thank you for your visit! Welcome back anytime..."
                  />
                  <Input
                    label="Receipt Sub-Header (Address line)"
                    value={form.receiptSubHeader || ''}
                    onChange={(e) => setForm({ ...form, receiptSubHeader: e.target.value })}
                    placeholder="123 Ahmadu Bello Way, Victoria Island · 0800 000 0000"
                  />
                  <Textarea
                    label="Receipt Footer"
                    rows={4}
                    value={form.receiptFooter}
                    onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
                    placeholder="Please come again.\nKeep your receipt for refunds.\nPowered by Prolific POS"
                  />
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">Tip</span>: Use newlines to break lines. Receipts automatically include branch name, address, phone, tax number, item lines, totals, and QR (if enabled).
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader padded>
                  <CardTitle>
                    <SectionHeader title="Auto-Printing" description="Trigger physical receipt / kitchen printers when order status changes" />
                  </CardTitle>
                </CardHeader>
                <div className="px-5 pb-5 space-y-0 divide-y divide-slate-100">
                  <ToggleRow
                    label="Enable Auto-Print"
                    description="Automatically print receipts from configured POS / cloud printers on new orders"
                    value={form.autoPrintEnabled}
                    onChange={(v) => setForm({ ...form, autoPrintEnabled: v })}
                  />
                  <ToggleRow
                    label="Separate Kitchen Print"
                    description="Send itemized copies to kitchen printer for food preparation tickets"
                    value={form.kitchenPrintEnabled}
                    onChange={(v) => setForm({ ...form, kitchenPrintEnabled: v })}
                  />
                  <div className="py-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        label="Copies per receipt"
                        value={String(form.autoPrintCopies)}
                        onChange={(e) => setForm({ ...form, autoPrintCopies: Math.max(1, Math.min(10, parseInt(e.target.value || '1'))) })}
                      />
                      <Select
                        label="Auto-print on these statuses (comma override in code)"
                        value={form.autoPrintOrderStatus.join(',')}
                        onChange={(e) => setForm({ ...form, autoPrintOrderStatus: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                        options={[
                          { value: 'NEW,PREPARING,READY', label: 'NEW → PREPARING → READY' },
                          { value: 'NEW', label: 'NEW only' },
                          { value: 'NEW,READY', label: 'NEW and READY' },
                          { value: 'COMPLETED,READY', label: 'READY + Paid' },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {activeSection === 'pricing' && (
            <Card>
              <CardHeader padded>
                <CardTitle>
                  <SectionHeader title="Pricing, Tax & Tipping" description="Tax defaults, price display, and tip suggestions at checkout" />
                </CardTitle>
              </CardHeader>
              <div className="px-5 pb-5 space-y-0 divide-y divide-slate-100">
                <div className="py-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Select
                      label="Default Tax Rate"
                      value={form.defaultTaxId}
                      onChange={(e) => setForm({ ...form, defaultTaxId: e.target.value })}
                      options={[
                        { value: '', label: '— No default —' },
                        ...taxes.map((t) => ({ value: t.id, label: `${t.name}  ·  ${Number(t.rate).toFixed(1)}%` })),
                      ]}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      label="Service Charge (%)"
                      value={String(form.serviceChargePercent)}
                      onChange={(e) => setForm({ ...form, serviceChargePercent: Math.max(0, parseFloat(e.target.value || '0')) })}
                      disabled={!form.serviceChargeEnabled}
                    />
                  </div>
                </div>
                <ToggleRow
                  label="Prices include tax"
                  description="Menu prices are displayed including tax (recommended for African markets); otherwise tax is added at checkout"
                  value={form.includeTaxInPrices}
                  onChange={(v) => setForm({ ...form, includeTaxInPrices: v })}
                />
                <ToggleRow
                  label="Apply Service Charge"
                  description="Add an automatic service charge percentage to every order's subtotal"
                  value={form.serviceChargeEnabled}
                  onChange={(v) => setForm({ ...form, serviceChargeEnabled: v })}
                />
                <ToggleRow
                  label="Allow custom tip entry"
                  description="Let customers enter a custom tip amount in addition to presets"
                  value={form.allowCustomTip}
                  onChange={(v) => setForm({ ...form, allowCustomTip: v })}
                />
                <div className="py-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      label="Default Tip Percent (%)"
                      value={String(form.defaultTipPercent)}
                      onChange={(e) => setForm({ ...form, defaultTipPercent: Math.max(0, parseFloat(e.target.value || '0')) })}
                    />
                    <Input
                      label="Tip Presets (%) (comma-separated)"
                      value={presetsStr}
                      onChange={(e) => setPresets(e.target.value)}
                      placeholder="e.g. 5, 10, 15"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {form.tipPresets.sort((a, b) => a - b).map((p) => (
                      <Badge key={p} variant="accent" className="px-3 py-1">{p}%</Badge>
                    ))}
                    {form.allowCustomTip && <Badge variant="outline" className="px-3 py-1">+ Custom</Badge>}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'kitchen' && (
            <Card>
              <CardHeader padded>
                <CardTitle>
                  <SectionHeader
                    title="Kitchen Stations"
                    description="List of preparation stations used for KDS (Kitchen Display System) and routing items to printers. Separate stations with new lines."
                    badge={`${form.kitchenStations.length} stations`}
                  />
                </CardTitle>
              </CardHeader>
              <div className="px-5 pb-5 space-y-4">
                <Textarea
                  label="Stations (one per line)"
                  rows={10}
                  placeholder="Grill Station\nFry Station\nCold Prep\nPantry\nPastry\nBar\nPasta Station\nExpediter Pass"
                  value={stationsStr}
                  onChange={(e) => setStations(e.target.value)}
                />
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">Preview · Order</div>
                  <ol className="divide-y divide-slate-100">
                    {form.kitchenStations.length === 0 && (
                      <li className="px-4 py-6 text-sm text-slate-400 text-center italic">No stations yet. Add stations in the textarea above.</li>
                    )}
                    {form.kitchenStations.map((s, idx) => (
                      <li key={idx} className="px-4 py-3 flex items-center gap-3 text-sm">
                        <span className="h-7 w-7 shrink-0 rounded-full bg-brand-50 text-brand-700 font-bold flex items-center justify-center text-xs">{idx + 1}</span>
                        <span className="font-semibold text-slate-800 flex-1">{s}</span>
                        <Badge variant="soft">Routing</Badge>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'orders' && (
            <Card>
              <CardHeader padded>
                <CardTitle>
                  <SectionHeader title="Ordering Workflow" description="Online channels and acceptance rules for incoming orders" />
                </CardTitle>
              </CardHeader>
              <div className="px-5 pb-5 space-y-0 divide-y divide-slate-100">
                <ToggleRow
                  label="Enable QR Ordering (tables)"
                  description="Customers can scan table QR codes to view the menu and place orders directly from their phones"
                  value={form.enableQROrdering}
                  onChange={(v) => setForm({ ...form, enableQROrdering: v })}
                />
                <ToggleRow
                  label="Enable Online Ordering (web/app)"
                  description="Accept orders from public website, branded apps, and marketplace integrations"
                  value={form.enableOnlineOrdering}
                  onChange={(v) => setForm({ ...form, enableOnlineOrdering: v })}
                />
                <div className="py-3">
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    label="Order Acceptance Timeout (minutes)"
                    value={String(form.orderAcceptanceTimeoutMinutes)}
                    onChange={(e) => setForm({ ...form, orderAcceptanceTimeoutMinutes: Math.max(0, Math.min(60, parseInt(e.target.value || '0'))) })}
                    description="If a new online order is not manually accepted within this window it will auto-escalate (push notification, PIN prompt). Set 0 to require no manual accept."
                  />
                </div>
                <div className="py-3 rounded-xl bg-brand-50/50 border border-brand-100 p-4 flex items-start gap-3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-brand-600 shrink-0 mt-0.5"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <div className="text-sm">
                    <div className="font-semibold text-brand-900">After saving</div>
                    <div className="text-brand-800/80 mt-0.5">These settings apply immediately to all POS stations, QR tablets, and kiosks associated with this branch. Customers will see updated menus / policies on their next page load.</div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          <div className="hidden lg:block" />

          <Card className="lg:sticky lg:bottom-4 z-10 border border-brand-200 bg-gradient-to-r from-white to-brand-50/40">
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                <span className="font-semibold text-slate-900">Unsaved changes?</span> Changes are saved to the branch settings collection via PATCH /settings.
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Button variant="outline" onClick={fetchSettings}>Discard</Button>
                <Button loading={saving} onClick={save} size="lg">Save All Settings</Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
