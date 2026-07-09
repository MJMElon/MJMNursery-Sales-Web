import React from 'react';
import { css } from './css.js';

// SEEDLING CALCULATOR PAGE — markup 1:1 from public/index.html. The result
// card (#calc-result-wrap) is rewritten by calcSeedlings() in main.js.
export default function CalculatorPage() {
  return (
    <div className="page" id="page-calculator">
      <div className="page-hero">
        <div className="page-hero-content">
          <div className="breadcrumb" onClick={() => window.showPage('home')}>Home <span>/ Plan Your Purchase / Seedling Calculator</span></div>
          <h1>Seedling <em>Calculator</em></h1>
        </div>
      </div>
      <div className="tool-page">
        <div className="tool-grid">
          <div className="tool-card">
            <h2>Calculate Your <em>Needs</em></h2>

            <div className="tool-field">
              <label>Land Area</label>
              <div className="tool-field-row">
                <input className="tool-input" type="number" id="calc-area" min="0" step="0.1" placeholder="e.g. 10" onInput={() => window.calcSeedlings()} />
                <select className="tool-select" id="calc-unit" defaultValue="ha" onChange={() => window.calcSeedlings()}>
                  <option value="ha">Hectares</option>
                  <option value="acre">Acres</option>
                </select>
              </div>
            </div>

            <div className="tool-field">
              <label>Planting Density</label>
              <div style={css('background:var(--cream);border:1.5px solid var(--green-pale);border-radius:10px;padding:.7rem 1rem;font-size:13px;color:var(--text-dark);line-height:1.5;')}>
                <strong>136 palms per hectare</strong> <span style={css('color:var(--text-light);')}>(≈ 55 palms per acre)</span>
                <div style={css('font-size:11px;color:var(--text-light);margin-top:.2rem;')}>9.2 m triangular spacing — Malaysian industry standard.</div>
              </div>
            </div>
          </div>

          <div id="calc-result-wrap">
            <div className="tool-card">
              <div className="tool-empty">
                <div style={css('font-size:2rem;margin-bottom:.5rem;')}>🌱</div>
                <div>Enter your land area on the left to see the recommended number of seedlings.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
