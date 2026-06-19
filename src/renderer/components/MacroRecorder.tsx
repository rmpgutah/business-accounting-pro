import React, { useState } from 'react';
import { Circle, StopCircle, Save, X } from 'lucide-react';
import api from '../lib/api';

interface RecordedAction {
  command_id: string;
  params: any;
  timestamp: number;
}

interface MacroRecorderProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const MacroRecorder: React.FC<MacroRecorderProps> = ({ isOpen, onClose, onSaved }) => {
  const [recording, setRecording] = useState(false);
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  const startRecording = () => { setRecording(true); setActions([]); };
  const stopRecording = () => { setRecording(false); };

  const handleSave = async () => {
    if (!name || actions.length === 0) return;
    await api.saveMacro({ name, description, action_sequence: actions });
    setRecording(false);
    setActions([]);
    setName('');
    setDescription('');
    onSaved();
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} className="block-card-elevated" style={{ width: '500px', padding: '24px', borderRadius: '8px' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-text-primary">Record Macro</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Name</label>
            <input className="block-input w-full" placeholder="My macro" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Description (optional)</label>
            <textarea className="block-input w-full" rows={2} placeholder="What does this macro do?" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 pt-2">
            {!recording ? (
              <button onClick={startRecording} className="block-btn-primary flex items-center gap-2 text-xs px-4 py-2" style={{ borderRadius: '6px' }}>
                <Circle size={12} fill="currentColor" /> Start Recording
              </button>
            ) : (
              <button onClick={stopRecording} className="block-btn flex items-center gap-2 text-xs px-4 py-2 text-accent-expense" style={{ borderRadius: '6px' }}>
                <StopCircle size={12} /> Stop Recording
              </button>
            )}
            <span className="text-xs text-text-muted">{actions.length} action(s) recorded</span>
          </div>
          <div className="text-[10px] text-text-muted pt-2 border-t border-border-primary mt-3">
            Note: Macro recording captures command palette actions. Open the palette (Cmd+K) and execute commands to record them. Stop recording when done.
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border-primary">
            <button onClick={onClose} className="block-btn text-xs px-4 py-2" style={{ borderRadius: '6px' }}>Cancel</button>
            <button onClick={handleSave} disabled={!name || actions.length === 0} className="block-btn-primary text-xs px-4 py-2 flex items-center gap-1" style={{ borderRadius: '6px' }}>
              <Save size={12} /> Save Macro
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MacroRecorder;
