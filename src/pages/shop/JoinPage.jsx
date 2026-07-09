import React from 'react';
import { css } from './css.js';

// JOIN OUR TEAM PAGE — markup 1:1 from public/index.html.
export default function JoinPage() {
  return (
    <div className="page" id="page-join">

      <div className="page-hero">
        <div className="page-hero-content">
          <div className="breadcrumb" onClick={() => window.showPage('home')}>Home <span>/ Join Our Team</span></div>
          <h1>Join <em>MJM Group</em></h1>
        </div>
      </div>

      <div className="join-page">
        <div className="join-intro">
          <div className="join-text">
            <span className="section-label">Career Opportunities</span>
            <h2>We are <em>continuously</em> hiring</h2>
            <p>No matter when you come across this page, if you are driven, responsible, and committed to growth — we would love to hear from you.</p>
            <p>At MJM Group, we seek individuals who strive for excellence. We are not merely filling positions, we are building future leaders.</p>
            <p>Our work across the oil palm industry, from nursery to plantation to palm oil mill operations, demands ambition, initiative, and the readiness to take on real-world challenges.</p>
            <p>This is an environment for those who are self-driven, resilient, and eager to develop their capabilities. If you are excited by growth, responsibility, and meaningful achievement — this could be your place.</p>
          </div>
          <div className="join-contact-box">
            <h3>Ready to Apply?</h3>
            <div className="join-email">
              <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
              <a href="mailto:recuit@puigroups.com">recuit@puigroups.com</a>
            </div>
            <p className="join-note">Send your resume to the email above. Shortlisted candidates will be contacted. We review applications on a rolling basis.</p>
            <div style={css('margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,.1)')}>
              <a
                href="mailto:recuit@puigroups.com"
                style={css('display:inline-flex;align-items:center;gap:.5rem;background:var(--gold);color:var(--green-dark);font-weight:500;font-size:14px;padding:.8rem 1.75rem;border-radius:8px;text-decoration:none;transition:background .2s;')}
                onMouseOver={(e) => { e.currentTarget.style.background = '#E8D49A'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = '#C9A84C'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                {' '}Send Resume Now
              </a>
            </div>
          </div>
        </div>

        <div className="join-info-grid">
          <div className="join-info-card">
            <h4>
              <svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              {' '}Work Locations
            </h4>
            <ul>
              <li>Batu Niah</li>
              <li>Bekenu</li>
              <li>Miri</li>
            </ul>
          </div>
          <div className="join-info-card">
            <h4>
              <svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
              {' '}Open Positions
            </h4>
            <ul>
              <li>Engineers</li>
              <li>Admin Executives</li>
              <li>Sales & Marketing</li>
            </ul>
          </div>
          <div className="join-info-card">
            <h4>
              <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              {' '}What We Value
            </h4>
            <ul>
              <li>Self-driven & resilient</li>
              <li>Committed to growth</li>
              <li>Leadership potential</li>
            </ul>
          </div>
        </div>

        <div className="join-resume-box">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
          <div>
            <h4>Your Resume Should Include</h4>
            <p>Position of interest · Preferred work location · Contact details (phone & email). Send to <a href="mailto:recuit@puigroups.com" style={css('color:var(--green-mid);font-weight:500;')}>recuit@puigroups.com</a></p>
          </div>
        </div>
      </div>

    </div>
  );
}
