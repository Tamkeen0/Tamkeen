import { Icon } from './icons';

function ExamArtwork() {
  return (
    <svg className="welcome-art" viewBox="0 0 580 410" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="art-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0v24" fill="none" stroke="#606d9d" strokeOpacity=".28" />
        </pattern>
      </defs>
      <rect width="580" height="410" fill="#111b38" />
      <rect width="580" height="410" fill="url(#art-grid)" />
      <g fill="none" stroke="#455781" strokeWidth="1.25">
        <path d="M0 83h84l36 36h68m260-12h73l29-29h30M0 318h118l49-49h46m194 34h61l35 35h77" />
        <path d="M297 0v44l32 32v24m-59 227v43l-40 40m138-110v47" />
        <circle cx="120" cy="119" r="5" fill="#111b38" /><circle cx="468" cy="303" r="5" fill="#111b38" />
        <circle cx="329" cy="76" r="4" fill="#111b38" /><circle cx="118" cy="318" r="4" fill="#111b38" />
      </g>
      <path d="M103 206h82m221 0h68" stroke="#66dfcb" strokeWidth="2" strokeDasharray="5 7" />
      <g transform="translate(62 171)">
        <rect width="81" height="74" rx="8" fill="#202c50" stroke="#52628b" />
        <path d="M16 38h6l5-11 8 23 8-32 8 28 6-14 5 6h4" stroke="#74ead5" fill="none" strokeWidth="2.4" strokeLinejoin="round" />
      </g>
      <g transform="translate(211 71) rotate(9 103 130)" fill="#303e6b" stroke="#485b8a">
        <rect width="206" height="260" rx="9" />
      </g>
      <g transform="translate(183 62)">
        <path d="M9 0h166l36 36v218a8 8 0 0 1-8 8H9a9 9 0 0 1-9-9V9a9 9 0 0 1 9-9Z" fill="#f8faff" />
        <path d="M175 0v28a8 8 0 0 0 8 8h28" fill="#cdd9f7" />
        <rect x="25" y="27" width="84" height="8" rx="4" fill="#4d56bd" />
        <path d="M25 55h134M25 68h108" stroke="#a3afcd" strokeWidth="4" strokeLinecap="round" />
        <rect x="25" y="91" width="161" height="112" rx="7" fill="#edf1fe" stroke="#d4dff8" />
        <path d="M46 118h21l7-9 9 18 9-18 9 18 7-9h56v59H46z" fill="none" stroke="#404cac" strokeWidth="2" strokeLinejoin="round" />
        <path d="M111 177v-59" fill="none" stroke="#007865" strokeWidth="2" />
        <path d="M104 143h14m-11 7h8" stroke="#007865" strokeWidth="2" />
        <circle cx="46" cy="118" r="4" fill="#f8faff" stroke="#404cac" strokeWidth="2" />
        <circle cx="111" cy="177" r="4" fill="#f8faff" stroke="#007865" strokeWidth="2" />
        <path d="M25 221h152m-152 13h96" stroke="#a3afcd" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g transform="translate(442 174)">
        <rect width="75" height="67" rx="8" fill="#202c50" stroke="#52628b" />
        <circle cx="37.5" cy="33.5" r="17" fill="#143e44" stroke="#63ddc7" />
        <path d="m29 33 6 6 11-12" stroke="#80f1dd" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g fill="#70e5d0"><circle cx="106" cy="83" r="3" /><circle cx="524" cy="107" r="3" /><circle cx="503" cy="338" r="3" /></g>
    </svg>
  );
}

export default function Welcome({ demo, enter }: { demo: boolean; enter: (role: 'professor' | 'student') => void }) {
  return (
    <>
      <div className="welcome-hero">
        <div className="welcome-copy">
          <p className="overline">Accessible STEM examinations</p>
          <h2 tabIndex={-1}>Empowering<br />every mind.</h2>
          <p className="welcome-summary">Prepare and take technical exams with accessible wording, keyboard navigation, and optional voice controls.</p>
          <a className="welcome-link" href="#choose-workspace">Choose a workspace <Icon name="arrow" /></a>
        </div>
        <div className="welcome-artwork"><ExamArtwork /></div>
      </div>

      <section className="role-section" aria-labelledby="choose-workspace">
        <div className="section-heading">
          <h3 id="choose-workspace" tabIndex={-1}>Choose your workspace</h3>
          <span className={'tag ' + (demo ? 'tag-demo' : 'tag-live')}>{demo ? 'Demo fixture' : 'Real API'}</span>
        </div>
        <div className="role-grid">
          <article className="role-entry">
            <span className="icon-tile"><Icon name="school" /></span>
            <div><h4>Professor</h4><p>Upload or scan an exam, verify the accessible draft, and publish it for students.</p></div>
            <button type="button" className="primary" onClick={() => enter('professor')}>Enter Professor workspace <Icon name="arrow" /></button>
          </article>
          <article className="role-entry">
            <span className="icon-tile teal"><Icon name="person" /></span>
            <div><h4>Student</h4><p>Open a published exam, explore circuit facts, and confirm answers at your own pace.</p></div>
            <button type="button" onClick={() => enter('student')}>Enter Student workspace <Icon name="arrow" /></button>
          </article>
        </div>
        {demo && <p className="role-note">Demo mode uses the sample exam. Work resets on reload or when you change data sources.</p>}
      </section>
    </>
  );
}
