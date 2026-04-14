import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Upload, X, Eye, GripVertical } from 'lucide-react';
import api from '../../lib/api';
import { generateInvoiceHTML, InvoiceSettings as ISettings, InvoiceColumnConfig, DEFAULT_COLUMNS } from '../../lib/print-templates';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Component ──────────────────────────────────────────
interface InvoiceSettingsProps {
  onBack: () => void;
}

const TEMPLATE_OPTIONS = [
  { value: 'classic',   label: 'Classic',   description: 'Accent-colored header bar with clean table layout' },
  { value: 'modern',    label: 'Modern',    description: 'Bold colored left panel, alternating row stripes' },
  { value: 'minimal',   label: 'Minimal',   description: 'Ultra-clean, hairline borders, maximum whitespace' },
  { value: 'executive', label: 'Executive', description: 'Two-tone split header with company watermark feel' },
  { value: 'compact',   label: 'Compact',   description: 'Dense layout for multi-page invoices, smaller type' },
] as const;

const FONT_OPTIONS = [
  { value: 'system',  label: 'System Sans',  description: 'Clean system-ui (default)' },
  { value: 'inter',   label: 'Segoe / Inter', description: 'Modern humanist sans-serif' },
  { value: 'georgia', label: 'Georgia',       description: 'Professional serif' },
  { value: 'mono',    label: 'Monospace',     description: 'Technical / developer invoices' },
] as const;

const HEADER_LAYOUT_OPTIONS = [
  { value: 'logo-left',   label: 'Logo Left',   description: 'Company info left, invoice number right (default)' },
  { value: 'logo-center', label: 'Logo Center',  description: 'Centered logo and company name at top' },
  { value: 'logo-right',  label: 'Logo Right',   description: 'Invoice number left, company info right' },
] as const;

const ACCENT_PRESETS = [
  '#2563eb', '#7c3aed', '#059669', '#dc2626', '#d97706',
  '#0891b2', '#be185d', '#1d4ed8', '#374151', '#065f46',
];

type FullSettings = ISettings & {
  footer_text: string;
  default_notes: string;
  default_terms_text: string;
  default_due_days: number;
  show_payment_terms: boolean;
  payment_qr_url: string;
  show_payment_qr: boolean;
  custom_field_1_label: string;
  custom_field_2_label: string;
  custom_field_3_label: string;
  custom_field_4_label: string;
};

const DEFAULT_SETTINGS: FullSettings = {
  accent_color: '#2563eb',
  secondary_color: '#64748b',
  logo_data: null,
  template_style: 'classic',
  show_logo: true,
  show_tax_column: true,
  show_payment_terms: true,
  footer_text: '',
  default_notes: '',
  default_terms_text: '',
  default_due_days: 30,
  watermark_text: '',
  watermark_opacity: 0.06,
  font_family: 'system',
  header_layout: 'logo-left',
  column_config: DEFAULT_COLUMNS,
  payment_qr_url: '',
  show_payment_qr: false,
  custom_field_1_label: '',
  custom_field_2_label: '',
  custom_field_3_label: '',
  custom_field_4_label: '',
};

// ─── Column Configurator (inline) ───────────────────────
interface ColConfigProps {
  columns: InvoiceColumnConfig[];
  onChange: (cols: InvoiceColumnConfig[]) => void;
}

const ColumnConfigurator: React.FC<ColConfigProps> = ({ columns, onChange }) => {
  const sorted = [...columns].sort((a, b) => a.order - b.order);

  const toggle = (key: string) => {
    onChange(columns.map(c => c.key === key ? { ...c, visible: !c.visible } : c));
  };

  const relabel = (key: string, label: string) => {
    onChange(columns.map(c => c.key === key ? { ...c, label } : c));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sorted.map((col) => (
        <div key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--color-bg-secondary)', borderRadius: '6px', border: '1px solid var(--color-border-primary)' }}>
          <GripVertical size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <input
            type="checkbox"
            checked={col.visible}
            onChange={() => toggle(col.key)}
            style={{ width: 14, height: 14, flexShrink: 0 }}
          />
          <input
            className="block-input"
            value={col.label}
            onChange={(e) => relabel(col.key, e.target.value)}
            style={{ flex: 1, padding: '3px 8px', fontSize: '12px' }}
          />
          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'monospace', minWidth: 80 }}>{col.key}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────
const InvoiceSettingsComponent: React.FC<InvoiceSettingsProps> = ({ onBack }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [settings, setSettings] = useState<FullSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getInvoiceSettings();
        if (data && !data.error) {
          let colConfig: InvoiceColumnConfig[] = DEFAULT_COLUMNS;
          if (data.column_config) {
            try {
              const parsed = typeof data.column_config === 'string'
                ? JSON.parse(data.column_config)
                : data.column_config;
              if (Array.isArray(parsed) && parsed.length > 0) colConfig = parsed;
            } catch { /* use defaults */ }
          }
          setSettings({
            accent_color: data.accent_color || '#2563eb',
            secondary_color: data.secondary_color || '#64748b',
            logo_data: data.logo_data || null,
            template_style: data.template_style || 'classic',
            show_logo: data.show_logo !== 0 && data.show_logo !== false,
            show_tax_column: data.show_tax_column !== 0 && data.show_tax_column !== false,
            show_payment_terms: data.show_payment_terms !== 0 && data.show_payment_terms !== false,
            footer_text: data.footer_text || '',
            default_notes: data.default_notes || '',
            default_terms_text: data.default_terms_text || '',
            default_due_days: data.default_due_days ?? 30,
            watermark_text: data.watermark_text || '',
            watermark_opacity: data.watermark_opacity ?? 0.06,
            font_family: data.font_family || 'system',
            header_layout: data.header_layout || 'logo-left',
            column_config: colConfig,
            payment_qr_url: data.payment_qr_url || '',
            show_payment_qr: data.show_payment_qr !== 0 && data.show_payment_qr !== false,
            custom_field_1_label: data.custom_field_1_label || '',
            custom_field_2_label: data.custom_field_2_label || '',
            custom_field_3_label: data.custom_field_3_label || '',
            custom_field_4_label: data.custom_field_4_label || '',
          });
        }
      } catch (err) {
        console.error('Failed to load invoice settings:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...settings,
        column_config: JSON.stringify(settings.column_config),
      };
      await api.saveInvoiceSettings(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save invoice settings:', err);
      alert('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 500 * 1024) { alert('Logo must be smaller than 500KB'); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setSettings((prev) => ({ ...prev, logo_data: dataUrl }));
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, []);

  const previewHTML = React.useMemo(() => {
    if (!showPreview) return '';
    const sampleInvoice = {
      invoice_number: 'INV-1042', issue_date: '2026-04-06', due_date: '2026-05-06',
      terms: 'Net 30', status: 'sent', subtotal: 2500, tax_amount: 200,
      discount_amount: 50, total: 2650, notes: 'Thank you for your business!',
      terms_text: settings.default_terms_text, amount_paid: 0,
    };
    const sampleCompany = activeCompany || { name: 'Your Company', email: 'info@company.com' };
    const sampleClient = { name: 'Acme Corporation', email: 'billing@acme.com', city: 'New York', state: 'NY' };
    const sampleLines = [
      { description: 'Web Design Services', quantity: 10, unit_price: 200, tax_rate: 8, amount: 2000, row_type: 'item', unit_label: 'hrs', item_code: 'WD-01', line_discount: 0, line_discount_type: 'percent' },
      { description: 'Monthly Maintenance', quantity: 1, unit_price: 500, tax_rate: 0, amount: 500, row_type: 'item', unit_label: 'mo', item_code: '', line_discount: 0, line_discount_type: 'percent' },
    ];
    return generateInvoiceHTML(sampleInvoice, sampleCompany, sampleClient, sampleLines, settings);
  }, [showPreview, settings, activeCompany]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-muted text-sm font-mono">Loading...</span>
      </div>
    );
  }

  const accent = settings.accent_color || '#2563eb';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="module-header" style={{ flexShrink: 0, padding: '0 24px', borderBottom: '1px solid var(--color-border-primary)' }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="block-btn p-2" title="Back"><ArrowLeft size={16} /></button>
          <h1 className="module-title text-text-primary">Invoice Studio Settings</h1>
        </div>
        <div className="module-actions">
          <button className="block-btn flex items-center gap-1.5" onClick={() => setShowPreview((v) => !v)}>
            <Eye size={14} />
            {showPreview ? 'Hide Preview' : 'Preview'}
          </button>
          <button className="block-btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: showPreview ? '520px' : '100%', flexShrink: 0, overflowY: 'auto', borderRight: showPreview ? '1px solid var(--color-border-primary)' : 'none', padding: '24px' }}>
          <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Template */}
            <div className="block-card">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Template Style</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {TEMPLATE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSettings((p) => ({ ...p, template_style: opt.value }))}
                    style={{
                      padding: '12px', borderRadius: '6px',
                      border: `2px solid ${settings.template_style === opt.value ? accent : 'var(--color-border-primary)'}`,
                      background: settings.template_style === opt.value ? `${accent}15` : 'var(--color-bg-secondary)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>{opt.label}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{opt.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Columns */}
            <div className="block-card">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
                Column Configurator
                <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>Toggle visibility · edit labels</span>
              </div>
              <ColumnConfigurator
                columns={settings.column_config as InvoiceColumnConfig[]}
                onChange={(cols) => setSettings((p) => ({ ...p, column_config: cols }))}
              />
            </div>

            {/* Branding */}
            <div className="block-card">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Branding</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Accent color */}
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">Primary Accent</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {ACCENT_PRESETS.map((color) => (
                      <button key={color} onClick={() => setSettings((p) => ({ ...p, accent_color: color }))}
                        style={{ width: 26, height: 26, borderRadius: '6px', background: color, border: settings.accent_color === color ? '3px solid var(--color-text-primary)' : '2px solid transparent', cursor: 'pointer', flexShrink: 0 }} title={color} />
                    ))}
                    <input type="color" value={settings.accent_color || '#2563eb'}
                      onChange={(e) => setSettings((p) => ({ ...p, accent_color: e.target.value }))}
                      style={{ width: 36, height: 26, borderRadius: '6px', border: '1px solid var(--color-border-primary)', padding: 2, cursor: 'pointer', background: 'transparent' }} />
                  </div>
                </div>
                {/* Secondary color */}
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">Secondary Accent</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="color" value={settings.secondary_color || '#64748b'}
                      onChange={(e) => setSettings((p) => ({ ...p, secondary_color: e.target.value }))}
                      style={{ width: 36, height: 26, borderRadius: '6px', border: '1px solid var(--color-border-primary)', padding: 2, cursor: 'pointer', background: 'transparent' }} />
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{settings.secondary_color}</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Used for row stripes and section fills</span>
                  </div>
                </div>
                {/* Watermark */}
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">Watermark Text</label>
                  <input className="block-input" placeholder='e.g. "CONFIDENTIAL" or company name'
                    value={settings.watermark_text || ''}
                    onChange={(e) => setSettings((p) => ({ ...p, watermark_text: e.target.value }))} />
                  {settings.watermark_text && (
                    <div style={{ marginTop: 8 }}>
                      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                        Opacity: {Math.round((settings.watermark_opacity ?? 0.06) * 100)}%
                      </label>
                      <input type="range" min={2} max={15} step={1}
                        value={Math.round((settings.watermark_opacity ?? 0.06) * 100)}
                        onChange={(e) => setSettings((p) => ({ ...p, watermark_opacity: parseInt(e.target.value) / 100 }))}
                        style={{ width: 200 }} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Font & Layout */}
            <div className="block-card">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Font &amp; Layout</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">Font Family</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    {FONT_OPTIONS.map((opt) => (
                      <button key={opt.value} onClick={() => setSettings((p) => ({ ...p, font_family: opt.value }))}
                        style={{ padding: '8px 12px', borderRadius: '6px', border: `2px solid ${settings.font_family === opt.value ? accent : 'var(--color-border-primary)'}`, background: settings.font_family === opt.value ? `${accent}15` : 'var(--color-bg-secondary)', cursor: 'pointer', textAlign: 'left' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' }}>{opt.label}</div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: 2 }}>{opt.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">Header Layout</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {HEADER_LAYOUT_OPTIONS.map((opt) => (
                      <button key={opt.value} onClick={() => setSettings((p) => ({ ...p, header_layout: opt.value }))}
                        style={{ padding: '8px 12px', borderRadius: '6px', border: `2px solid ${settings.header_layout === opt.value ? accent : 'var(--color-border-primary)'}`, background: settings.header_layout === opt.value ? `${accent}15` : 'var(--color-bg-secondary)', cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' }}>{opt.label}</div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>{opt.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Logo */}
            <div className="block-card">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Company Logo</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {settings.logo_data ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img src={settings.logo_data} alt="Company logo" style={{ height: 60, maxWidth: 200, objectFit: 'contain', borderRadius: '4px', border: '1px solid var(--color-border-primary)' }} />
                    <button onClick={() => setSettings((p) => ({ ...p, logo_data: null }))}
                      style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 18, height: 18, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Remove logo">
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <div style={{ width: 80, height: 60, borderRadius: '4px', border: '1px dashed var(--color-border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>No logo</span>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="block-btn flex items-center gap-2" onClick={handleLogoUpload}>
                    <Upload size={14} />Upload Logo
                  </button>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>PNG, JPG, SVG · max 500KB</span>
                </div>
              </div>
            </div>

            {/* Display Options */}
            <div className="block-card">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Display Options</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {([
                  ['show_logo', 'Show company logo'],
                  ['show_tax_column', 'Show tax column in line items'],
                  ['show_payment_terms', 'Show payment terms section'],
                  ['show_payment_qr', 'Show payment QR code in PDF'],
                ] as const).map(([field, label]) => (
                  <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={!!(settings as any)[field]}
                      onChange={(e) => setSettings((p) => ({ ...p, [field]: e.target.checked }))}
                      style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    <span style={{ fontSize: '13px', color: 'var(--color-text-primary)' }}>{label}</span>
                  </label>
                ))}
              </div>
              {settings.show_payment_qr && (
                <div style={{ marginTop: 12 }}>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Payment Link Base URL</label>
                  <input className="block-input" placeholder="https://pay.stripe.com/c/pay/your-link"
                    value={settings.payment_qr_url || ''}
                    onChange={(e) => setSettings((p) => ({ ...p, payment_qr_url: e.target.value }))} />
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 4 }}>
                    QR links to this URL + "/" + invoice number
                  </div>
                </div>
              )}
            </div>

            {/* Footer & Defaults */}
            <div className="block-card">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Footer &amp; Defaults</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Footer Text</label>
                  <input type="text" className="block-input" placeholder="e.g. Thank you for your business!"
                    value={settings.footer_text}
                    onChange={(e) => setSettings((p) => ({ ...p, footer_text: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Default Notes</label>
                  <textarea className="block-input" rows={3} placeholder="Notes that appear on every new invoice by default..."
                    value={settings.default_notes}
                    onChange={(e) => setSettings((p) => ({ ...p, default_notes: e.target.value }))}
                    style={{ resize: 'vertical' }} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Default Terms &amp; Conditions</label>
                  <textarea className="block-input" rows={3} placeholder="Terms that appear on every new invoice by default..."
                    value={settings.default_terms_text}
                    onChange={(e) => setSettings((p) => ({ ...p, default_terms_text: e.target.value }))}
                    style={{ resize: 'vertical' }} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Default Due Days</label>
                  <input type="number" min={0} max={365} className="block-input" style={{ width: 120 }}
                    value={settings.default_due_days}
                    onChange={(e) => setSettings((p) => ({ ...p, default_due_days: parseInt(e.target.value) || 30 }))} />
                </div>
              </div>
            </div>

            {/* Custom Fields */}
            <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
              <h3 className="text-sm font-bold text-text-primary">Custom Fields</h3>
              <p className="text-xs text-text-muted">
                Define up to 4 custom fields that appear on every invoice header. Leave a label blank to hide that field.
              </p>
              {[1, 2, 3, 4].map((n) => {
                const key = `custom_field_${n}_label` as keyof FullSettings;
                const placeholders = ['e.g. Purchase Order', 'e.g. Department', 'e.g. Contract #', 'e.g. Cost Center'];
                return (
                  <div key={n}>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                      Field {n} Label
                    </label>
                    <input
                      className="block-input"
                      placeholder={placeholders[n - 1]}
                      value={(settings[key] as string) || ''}
                      onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>

          </div>
        </div>

        {/* Preview pane */}
        {showPreview && (
          <div style={{ flex: 1, overflow: 'hidden', background: '#f1f5f9', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 12px', fontSize: '11px', color: '#64748b', fontWeight: 600, background: '#e2e8f0', borderBottom: '1px solid #cbd5e1', flexShrink: 0 }}>
              SAMPLE PREVIEW — updates live as you change settings
            </div>
            <iframe srcDoc={previewHTML} title="Invoice Template Preview"
              style={{ flex: 1, border: 'none', width: '100%', background: '#fff' }}
              sandbox="allow-same-origin" />
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoiceSettingsComponent;
