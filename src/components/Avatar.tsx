import type { Member } from '../../shared/types';

export function Avatar({ member, size = 44, ring }: { member: Member; size?: number; ring?: boolean }) {
  return (
    <span
      className={`avatar ${ring ? 'ring' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.5, background: member.color + '33', borderColor: member.color }}
      title={member.name}
    >
      {member.emoji}
    </span>
  );
}

export function MemberPicker({ members, value, onChange, multi = true }: { members: Member[]; value: string[]; onChange: (ids: string[]) => void; multi?: boolean }) {
  return (
    <div className="member-picker">
      {members.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            className={`member-pick ${on ? 'on' : ''}`}
            style={{ '--c': m.color } as React.CSSProperties}
            onClick={() => onChange(multi ? (on ? value.filter((x) => x !== m.id) : [...value, m.id]) : [m.id])}
          >
            <span>{m.emoji}</span> {m.name}
          </button>
        );
      })}
    </div>
  );
}
