/**
 * Entry point. Boots the app shell and hands control to the first scene.
 */

import './styles/main.css';
import { App } from './game/app';
import { MenuScene } from './game/scenes/menu';
import { MatchScene } from './game/scenes/match';
import { buildMatch } from './meta/modes';
import { audio } from './engine/audio';

function boot(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app container missing');

  const app = new App(root);

  // Audio cannot start before a gesture, so the first interaction anywhere
  // unlocks it once and then gets out of the way.
  const unlock = () => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // A first-time player goes straight into the guided match; everyone else
  // lands on the menu.
  if (!app.profile.tutorialDone) {
    app.saveProfile({ ...app.profile, tutorialDone: true });
    void app.go(new MatchScene(buildMatch({ mode: 'tutorial', difficulty: 'rookie', loadout: app.profile.loadout })));
  } else {
    void app.go(new MenuScene());
  }

  // Pause the loop while backgrounded so a phone is not burning battery on a
  // game nobody is looking at.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') app.stop();
    else void app.resize();
  });

  window.addEventListener('pagehide', () => app.dispose());

  document.body.classList.remove('loading');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
