import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'education',
  label: 'Education / Tutoring',
  description: 'Lesson billing, course revenue, educator expenses',
  icon: 'GraduationCap',
  coaTemplateKey: 'service',
  defaultCategories: [
    { name: 'Tuition Revenue', type: 'income', color: '#22c55e', tax_deductible: false },
    { name: 'Tutoring / Lesson Fees', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Course Sales', type: 'income', color: '#10b981', tax_deductible: false },
    { name: 'Materials & Workbooks', type: 'income', color: '#84cc16', tax_deductible: false },
    { name: 'Curriculum & Materials', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'Educator Wages', type: 'expense', color: '#dc2626', tax_deductible: true },
    { name: 'Software & Learning Tools', type: 'expense', color: '#6366f1', tax_deductible: true },
    { name: 'Professional Development', type: 'expense', color: '#8b5cf6', tax_deductible: true },
    { name: 'Facility Rent', type: 'expense', color: '#a855f7', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'Curriculum Publisher', type: 'inventory' },
    { name: 'Online Learning Platform', type: 'subscription' },
  ],
  invoiceSettings: {
    accent_color: '#0891b2',
    default_due_days: 7,
    default_terms_text: 'Tuition due before first session of the month.',
    default_notes: 'Invest in your future — keep learning!',
  },
  defaultDeductions: [
    { name: 'Educator Expense ($300)', type: 'business' },
    { name: 'Continuing Education', type: 'professional' },
  ],
  industrySpecificFields: [
    { entity_type: 'clients', key: 'student_grade_level', label: 'Grade Level', field_type: 'text' },
    { entity_type: 'clients', key: 'subject', label: 'Subject', field_type: 'text' },
    { entity_type: 'projects', key: 'course_name', label: 'Course Name', field_type: 'text' },
    { entity_type: 'projects', key: 'session_count', label: 'Session Count', field_type: 'number' },
  ],
  setupHints: [
    { key: 'session-packages', title: 'Set up session packages', description: 'Bundle lessons into prepaid packages for better cash flow.' },
    { key: 'recurring-tuition', title: 'Recurring tuition billing', description: 'Auto-bill monthly tuition for ongoing students.' },
  ],
  dashboardWidgets: [
    { key: 'active_students', label: 'Active Students', type: 'kpi' },
    { key: 'revenue_per_session', label: 'Avg Revenue / Session', type: 'kpi' },
  ],
};

export default preset;
