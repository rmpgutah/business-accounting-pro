# Dynamic Fillable Equipment Assessment Template

A complete system for creating, editing, and exporting fillable PDF equipment assessment statements with form fields.

## Overview

This implementation provides:

- **Dynamic Fillable PDFs** with AcroForm fields (editable in Adobe Reader, Preview, etc.)
- **React Component** for interactive form editing
- **Database Storage** with audit trail and content sealing
- **IPC Integration** for seamless Electron app communication
- **Programmatic Generation** for batch PDF creation

## Architecture

### Core Components

```
src/
├── shared/types/
│   └── equipment-assessment.ts          # Type definitions
├── renderer/
│   ├── components/
│   │   └── EquipmentAssessmentTemplate.tsx  # React form component
│   └── lib/pdf-templates/
│       └── equipment-assessment.ts      # PDF generation (pdf-lib)
├── main/
│   ├── ipc/
│   │   └── equipment-assessment.ts      # IPC handlers (CRUD + PDF export)
│   └── database/
│       └── schema.sql                   # equipment_assessments table
└── modules/hr/
    └── EquipmentAssessmentModule.example.tsx  # Integration examples
```

### Data Flow

```
User Input (React Component)
    ↓
EquipmentAssessmentTemplate (form binding)
    ↓
api.equipmentAssessmentSave() [IPC call]
    ↓
equipment-assessment IPC handler (main process)
    ↓
SQLite: equipment_assessments table
    ↓
[Content Seal: SHA256 hash for immutability]
```

## Type Definitions

```typescript
interface EquipmentAssessment {
  documentId: string;              // Unique identifier (e.g., "EQ-ASSESS-2026-0001")
  executedDate: string;            // ISO datetime
  governingLaw: string;            // e.g., "Utah" or "Montana (worksite) / Utah (principal)"
  penaltyScheduleVersion: string;  // e.g., "2026-03-01"

  // Parties
  employerName: string;
  employerAddress: string;
  employeeName: string;
  employeeAddress: string;

  // Equipment and charges (structured arrays)
  equipment: EquipmentItem[];
  assessedCharges: AssessedCharge[];

  // Aggregates
  totalEquipmentValue: number;
  totalAssessed: number;

  // Metadata
  notes?: string;
  contentSeal?: string;            // SHA256 hash for audit trail
}

interface EquipmentItem {
  id?: string;
  itemName: string;
  model: string;
  condition: 'new' | 'used' | 'refurbished' | 'damaged';
  issuedDate: string;              // ISO date
  value: number;
  history?: string[];              // Timeline of events
}

interface AssessedCharge {
  id?: string;
  tier: string;                    // e.g., "5.M.1 [M]"
  description: string;
  amount: number;
  basis: string;                   // How amount was calculated
}
```

## PDF Generation

The PDF template creates **fillable form fields** using pdf-lib's AcroForm support:

### Features

- **Interactive Form Fields**: Each value becomes an editable text field in the PDF
- **Structured Layout**: Professional invoice-like appearance
- **Dynamic Equipment/Charges**: Renders all items from data arrays
- **Audit Trail**: Content seal (SHA256) for verification
- **Light-weight**: Uses pdf-lib (no external PDF tools required)

### PDF Form Fields

Form fields are automatically created for:
- `documentId` - Document identifier
- `executedDate` - Execution date
- `governingLaw` - Governing law
- `employerName` - Employer name
- `employerAddress` - Employer address
- `employeeName` - Employee name
- `employeeAddress` - Employee address

Equipment and charge items are rendered as static text (not individual form fields).

## Usage Examples

### 1. Create New Assessment

```typescript
import EquipmentAssessmentTemplate from '@/renderer/components/EquipmentAssessmentTemplate';
import api from '@/renderer/lib/api';

const NewAssessment = () => {
  const [assessment, setAssessment] = useState<EquipmentAssessment>({
    documentId: 'EQ-ASSESS-2026-0001',
    executedDate: new Date().toISOString(),
    governingLaw: 'Utah',
    penaltyScheduleVersion: '2026-03-01',
    employerName: 'Your Company LLC',
    employerAddress: '123 Main St, Salt Lake City, UT 84111',
    employeeName: 'John Doe',
    employeeAddress: '456 Oak Ave, Salt Lake City, UT 84111',
    equipment: [
      {
        itemName: 'Laptop',
        model: 'MacBook Pro 14"',
        condition: 'damaged',
        issuedDate: '2026-01-15',
        value: 2499.99,
        history: ['2026-01-15 - Issued', '2026-03-10 - Returned damaged'],
      },
    ],
    assessedCharges: [
      {
        tier: '5.M.1 [M]',
        description: 'Loss of Equipment',
        amount: 2499.99,
        basis: 'Full equipment value',
      },
    ],
    totalEquipmentValue: 2499.99,
    totalAssessed: 2499.99,
  });

  const handleSave = async (data: EquipmentAssessment) => {
    const result = await api.equipmentAssessmentSave(data);
    console.log('Saved:', result.id);
  };

  return (
    <EquipmentAssessmentTemplate
      data={assessment}
      onSave={handleSave}
      readOnly={false}
    />
  );
};
```

### 2. Load and Edit

```typescript
const EditAssessment = ({ assessmentId }: { assessmentId: string }) => {
  const [assessment, setAssessment] = useState<EquipmentAssessment | null>(null);

  useEffect(() => {
    const load = async () => {
      const data = await api.equipmentAssessmentLoad(assessmentId);
      setAssessment(data);
    };
    load();
  }, [assessmentId]);

  if (!assessment) return <div>Loading...</div>;

  const handleSave = async (data: EquipmentAssessment) => {
    await api.equipmentAssessmentSave(data);
  };

  return (
    <EquipmentAssessmentTemplate
      data={assessment}
      onSave={handleSave}
      readOnly={false}
    />
  );
};
```

### 3. Export to PDF

```typescript
// Inside component with assessment data
const handleExportPDF = async () => {
  const filePath = await api.equipmentAssessmentExportPDF(assessment);
  console.log('Exported to:', filePath);
};

<button onClick={handleExportPDF}>
  Download PDF
</button>
```

### 4. Programmatic PDF Generation

```typescript
// Generate PDF bytes without saving to database
const pdfBytes = await api.equipmentAssessmentGeneratePDF(assessment);

// Send to server or save directly
const blob = new Blob([pdfBytes], { type: 'application/pdf' });
const url = URL.createObjectURL(blob);
```

## IPC Handlers

All handlers are registered at app startup via `registerEquipmentAssessmentIpc()`.

### `equipment-assessment:generate-pdf`
Generates a fillable PDF from assessment data.

**Input**: `EquipmentAssessment`
**Returns**: `Uint8Array` (PDF bytes)

### `equipment-assessment:save`
Saves or updates assessment in database.

**Input**: `EquipmentAssessment`
**Returns**: `{ id: string; created: boolean }`

### `equipment-assessment:load`
Loads assessment by ID.

**Input**: `assessmentId: string`
**Returns**: `EquipmentAssessment`

### `equipment-assessment:list`
Lists all assessments for current company.

**Input**: None
**Returns**: `Array<{ id, document_id, employee_name, total_assessed, created_at }>`

### `equipment-assessment:delete`
Deletes assessment by ID.

**Input**: `assessmentId: string`
**Returns**: `boolean`

### `equipment-assessment:export-pdf`
Exports PDF to user-selected location (with file picker).

**Input**: `EquipmentAssessment`
**Returns**: `string | null` (file path, or null if cancelled)

## Database Schema

```sql
CREATE TABLE equipment_assessments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  document_id TEXT NOT NULL UNIQUE,
  executed_date TEXT NOT NULL,
  governing_law TEXT,
  penalty_schedule_version TEXT,

  -- Parties
  employer_name TEXT NOT NULL,
  employer_address TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  employee_address TEXT NOT NULL,

  -- JSON storage for flexibility
  equipment_json TEXT,       -- Array of EquipmentItem
  charges_json TEXT,         -- Array of AssessedCharge

  -- Aggregates
  total_equipment_value REAL,
  total_assessed REAL,

  -- Audit
  notes TEXT,
  content_seal TEXT,         -- SHA256 for immutability verification

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_equipment_assessments_company ON equipment_assessments(company_id);
CREATE INDEX idx_equipment_assessments_document ON equipment_assessments(document_id);
CREATE INDEX idx_equipment_assessments_created ON equipment_assessments(created_at);
```

## Audit Trail

Each assessment includes:

- **`created_at`**: When record was created
- **`updated_at`**: Last modification timestamp
- **`content_seal`**: SHA256 hash of core data (immutability verification)

To verify assessment hasn't been tampered with:

```typescript
const contentString = JSON.stringify({
  documentId: assessment.documentId,
  executedDate: assessment.executedDate,
  employerName: assessment.employerName,
  employeeName: assessment.employeeName,
  equipment: assessment.equipment,
  assessedCharges: assessment.assessedCharges,
  totalEquipmentValue: assessment.totalEquipmentValue,
  totalAssessed: assessment.totalAssessed,
});
const hash = crypto.createHash('sha256').update(contentString).digest('hex');
const isValid = hash === assessment.contentSeal;
```

## Customization

### Modify PDF Layout

Edit `src/renderer/lib/pdf-templates/equipment-assessment.ts`:

```typescript
// Change margins, fonts, colors, field positions
const MARGIN = 40;
const LINE_HEIGHT = 20;
const FIELD_BOX_COLOR = rgb(0.95, 0.95, 0.98);
```

### Add Fields to Component

Update `src/renderer/components/EquipmentAssessmentTemplate.tsx`:

```typescript
// Add new section
<section>
  <h2>New Section</h2>
  <FormInput
    label="New Field"
    value={data.newField}
    onChange={(v) => updateData({ newField: String(v) })}
  />
</section>
```

### Change Storage Format

By default, equipment and charges are stored as JSON. To normalize into separate tables:

1. Update schema.sql (create `equipment_assessment_items` table)
2. Modify IPC handler to INSERT/SELECT from separate tables
3. Update React component as needed

## Styling

The component uses BAP's design tokens:

- **Colors**: `bg-primary`, `text-primary`, `accent-primary`, `color-accent-blue`
- **Borders**: `border-border-structure`, `border-hairline`
- **Radius**: `var(--app-radius)` (theme-driven, defaults 6px)

All colors inherit from `globals.css` personalization system—no hard-coded hex values.

## Performance Notes

- **PDF Generation**: ~200-300ms per document (including font embedding)
- **Database Queries**: Indexed on `company_id` and `document_id`
- **Form Rendering**: Optimized with React.memo and callback memoization
- **Memory**: JSON storage allows arbitrary equipment/charge counts

## Integration Points

### 1. HR Module
Add equipment assessment view to HR → Employee Management

### 2. Payroll Module
Link to payroll deductions when charges are assessed

### 3. Documents Module
Store generated PDFs in document vault

### 4. Email Integration
Send PDF via `api.sendEquipmentAssessmentEmail(assessmentId, recipientEmail)`

## Troubleshooting

### PDF form fields not editable
- Ensure `fillableFields: true` in `generateEquipmentAssessmentPDF()` options
- PDF viewer must support AcroForms (Adobe Reader, Preview all support this)

### Assessment not saving
- Check company context: `db.getCurrentCompanyId()` must return a value
- Check database: `SELECT * FROM equipment_assessments` in SQLite browser

### Content seal mismatch
- Ensure JSON serialization order is consistent
- Don't modify assessment data outside of the component/API

## Future Enhancements

- [ ] E-signature field (ESIGN module integration)
- [ ] Multi-page PDF for large equipment lists
- [ ] Equipment photo attachment support
- [ ] Bulk export (multiple assessments as ZIP)
- [ ] Email notification templates
- [ ] Equipment depreciation calculation integration
- [ ] Tax deduction impact analysis
