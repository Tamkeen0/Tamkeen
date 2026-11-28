import { WorkspaceIntro } from './components';

export default function Welcome({ demo, enter }: { demo: boolean; enter: (role: 'professor' | 'student') => void }) {
  return (
    <div className="reading-column">
      <WorkspaceIntro title="Welcome to Tamkeen"
        description="Prepare and take STEM exams with accessible wording, keyboard navigation, and optional voice controls." />
      <div className="actions">
        <button type="button" className="primary" onClick={() => enter('student')}>Enter Student workspace</button>
        <button type="button" onClick={() => enter('professor')}>Enter Professor workspace</button>
      </div>
      {demo && <p className="role-note">Demo mode uses a sample exam. Work resets if you reload or change the data source.</p>}
    </div>
  );
}
