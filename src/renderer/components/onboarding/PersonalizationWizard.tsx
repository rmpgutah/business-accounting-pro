import React, { useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';
import { usePersonalizationStore, ACCENT_PRESETS, type Density } from '../../stores/personalizationStore';

// Onboarding wizard (feature #30) — asks role, density, accent and seeds
// settings accordingly. Shown automatically on first run when
// onboardingComplete is false.

interface Props {
  onClose: () => void;
}

const PersonalizationWizard: React.FC<Props> = ({ onClose }) => {
  const set = usePersonalizationStore((s) => s.set);
  const setAccent = usePersonalizationStore((s) => s.setAccent);

  const [step, setStep] = useState(0);
  const [role, setRole] = useState<'Owner' | 'Manager' | 'Accountant' | 'Viewer'>('Owner');
  const [density, setDensity] = useState<Density>('cozy');
  const [accent, setLocalAccent] = useState<string>('#60a5fa');

  const finish = () => {
    setAccent('primary', accent);
    setAccent('blue', accent);
    set({ density, onboardingComplete: true });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-lg p-6 space-y-5"
        style={{
          borderRadius: 'var(--app-radius, 10px)',
          background: 'rgba(20, 22, 30, 0.95)',
          backdropFilter: 'blur(24px) saturate(1.5)',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <Sparkles size={20} className="text-accent-warning" />
          <div>
            <h2 className="text-lg font-bold text-text-primary">Welcome — let's personalize</h2>
            <p className="text-xs text-text-muted">Three quick questions. You can change everything later in Settings.</p>
          </div>
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">What's your role?</p>
            <div className="grid grid-cols-2 gap-2">
              {(['Owner', 'Manager', 'Accountant', 'Viewer'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`p-3 text-left text-sm transition-colors ${
                    role === r ? 'bg-accent-blue text-white' : 'bg-bg-tertiary text-text-primary hover:bg-bg-hover'
                  }`}
                  style={{ borderRadius: 'var(--app-radius, 6px)' }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">Density preference?</p>
            <div className="grid grid-cols-3 gap-2">
              {(['compact', 'cozy', 'comfortable'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDensity(d)}
                  className={`p-3 text-sm transition-colors ${
                    density === d ? 'bg-accent-blue text-white' : 'bg-bg-tertiary text-text-primary hover:bg-bg-hover'
                  }`}
                  style={{ borderRadius: 'var(--app-radius, 6px)' }}
                >
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">Pick an accent color</p>
            <div className="flex gap-2 flex-wrap">
              {ACCENT_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setLocalAccent(p.value)}
                  className="w-10 h-10 transition-transform hover:scale-110"
                  style={{
                    background: p.value,
                    borderRadius: 'var(--app-radius, 4px)',
                    border: accent === p.value ? '3px solid #fff' : '3px solid rgba(255,255,255,0.1)',
                  }}
                  title={p.name}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border-primary">
          <button className="block-btn text-xs" onClick={onClose}>
            Skip
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted">Step {step + 1} of 3</span>
            {step < 2 ? (
              <button
                className="block-btn-primary flex items-center gap-1.5 text-xs"
                onClick={() => setStep(step + 1)}
              >
                Next <ChevronRight size={12} />
              </button>
            ) : (
              <button className="block-btn-primary text-xs" onClick={finish}>
                Finish
              </button>
            )}
          </div>
        </div>

        <p className="text-[10px] text-text-muted">
          Selected role: <span className="text-text-secondary">{role}</span> ·
          density: <span className="text-text-secondary">{density}</span> ·
          accent: <span className="text-text-secondary">{accent}</span>
        </p>
      </div>
    </div>
  );
};

export default PersonalizationWizard;
