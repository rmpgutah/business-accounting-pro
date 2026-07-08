import React, { useEffect, useState } from 'react';
import { Building2, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';

interface Department {
  id: string;
  code: string;
  name: string;
  manager_id: string;
}

interface EmployeeOption {
  id: string;
  name: string;
}

const DepartmentsManager: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editManager, setEditManager] = useState('');

  const load = async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');
    try {
      const [depts, emps] = await Promise.all([
        api.query('departments', { company_id: activeCompany.id }, { field: 'name', dir: 'asc' }),
        api.query('employees', { company_id: activeCompany.id, status: 'active' }, { field: 'name', dir: 'asc' }),
      ]);
      setDepartments(Array.isArray(depts) ? depts : []);
      setEmployees(Array.isArray(emps) ? emps : []);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeCompany?.id]);

  const handleCreate = async () => {
    if (!newCode.trim() || !newName.trim()) return;
    try {
      const result = await api.create('departments', { code: newCode.trim(), name: newName.trim(), manager_id: '' });
      if (result && (result as any).error) {
        setError((result as any).error);
        return;
      }
      setNewCode('');
      setNewName('');
      await load();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  const startEdit = (d: Department) => {
    setEditingId(d.id);
    setEditCode(d.code);
    setEditName(d.name);
    setEditManager(d.manager_id || '');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const result = await api.update('departments', editingId, { code: editCode.trim(), name: editName.trim(), manager_id: editManager });
      if (result && (result as any).error) {
        setError((result as any).error);
        return;
      }
      setEditingId(null);
      await load();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await api.remove('departments', id);
      if (result && (result as any).error) {
        setError((result as any).error);
        return;
      }
      await load();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  if (loading) {
    return <div className="p-6 text-xs font-mono text-text-muted">Loading departments...</div>;
  }

  return (
    <div className="p-6 space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      <div className="flex items-center gap-2">
        <input
          className="block-input"
          style={{ width: '140px' }}
          placeholder="Code (e.g. ENG)"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        <input
          className="block-input flex-1"
          placeholder="New department name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        <button className="block-btn block-btn-primary inline-flex items-center gap-1.5" onClick={handleCreate}>
          <Plus size={14} /> Add Department
        </button>
      </div>

      <div className="block-table-wrap">
        <table className="block-table w-full">
          <thead>
            <tr>
              <th>Code</th>
              <th>Department</th>
              <th>Head</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id}>
                {editingId === d.id ? (
                  <>
                    <td>
                      <input className="block-input w-full" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                    </td>
                    <td>
                      <input className="block-input w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </td>
                    <td>
                      <select className="block-select w-full" value={editManager} onChange={(e) => setEditManager(e.target.value)}>
                        <option value="">No head assigned</option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right">
                      <button className="text-accent-income mr-2" onClick={saveEdit}><Check size={14} /></button>
                      <button className="text-text-muted" onClick={() => setEditingId(null)}><X size={14} /></button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="text-text-secondary text-xs font-mono">{d.code}</td>
                    <td className="flex items-center gap-2">
                      <Building2 size={14} className="text-accent-blue shrink-0" />
                      <span className="text-text-primary font-medium">{d.name}</span>
                    </td>
                    <td className="text-text-secondary text-xs">
                      {employees.find((e) => e.id === d.manager_id)?.name ?? '--'}
                    </td>
                    <td className="text-right">
                      <button className="text-text-muted hover:text-text-primary mr-2" onClick={() => startEdit(d)}><Pencil size={14} /></button>
                      <button className="text-text-muted hover:text-accent-expense" onClick={() => handleDelete(d.id)}><Trash2 size={14} /></button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {departments.length === 0 && (
        <div className="text-xs text-text-muted">No departments yet. Add one above.</div>
      )}
    </div>
  );
};

export default DepartmentsManager;
