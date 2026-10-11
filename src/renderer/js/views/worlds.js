'use strict';
/* Mondi: elenco, importazione, mondo attivo, nuovo mondo, esportazione, datapack. */

function renderWorlds(body, s) {
  const running = isUp(s);
  const grid = h('.world-grid');

  const importWorld = () => openWorldPicker(async (src, label) => {
    if (await run(() => api('worlds:import', s.id, src, { activate: true }), `Mondo "${label}" importato e attivato`)) load();
  });

  const newWorld = () => {
    const name = h('input.input', { value: 'nuovo-mondo' });
    const seed = h('input.input', { placeholder: 'casuale' });
    const type = h('select.input', [['minecraft:normal', 'Normale'], ['minecraft:flat', 'Piatto'], ['minecraft:large_biomes', 'Biomi grandi'], ['minecraft:amplified', 'Amplificato']].map(([v, l]) => h('option', { value: v }, l)));
    const structures = h('input', { type: 'checkbox', checked: true });
    const hardcore = h('input', { type: 'checkbox' });
    const m = modal({
      title: 'Nuovo mondo',
      body: h('.col',
        h('.info-note', icon('info'), 'Il mondo attuale resta nella cartella del server: potrai riattivarlo quando vuoi. Il nuovo mondo viene generato al prossimo avvio.'),
        h('.field', h('label', 'Nome cartella'), name),
        h('.grid-2', h('.field', h('label', 'Seed'), seed), h('.field', h('label', 'Tipo'), type)),
        h('label.check', structures, h('span', 'Genera strutture (villaggi, templi…)')),
        h('label.check', hardcore, h('span', 'Hardcore'))),
      foot: [btn('Annulla', { onclick: () => m.close() }), btn('Crea', { cls: 'primary', onclick: async () => {
        m.close();
        const f = await run(() => api('worlds:createNew', s.id, { name: name.value.trim(), seed: seed.value.trim(), levelType: type.value, generateStructures: structures.checked, hardcore: hardcore.checked }));
        if (f) { toast(`Mondo "${f}" pronto: avvia il server per generarlo`, 'ok'); load(); }
      } })],
    });
  };

  const datapacks = async (w) => {
    const list = h('.list');
    const draw = async () => {
      list.innerHTML = '';
      const items = await run(() => api('worlds:datapacks', s.id, w.folder)) || [];
      if (!items.length) list.appendChild(h('.empty', { style: { padding: '20px' } }, 'Nessun datapack'));
      items.forEach((d) => list.appendChild(h('.list-item', h('.li-icon', icon(d.isDir ? 'folder' : 'archive')), h('.li-main', h('.li-title', d.name)),
        btn('', { cls: 'sm ghost icon', icon: 'trash', onclick: async () => { await run(() => api('worlds:removeDatapack', s.id, w.folder, d.name)); draw(); } }))));
    };
    const m = modal({
      title: `Datapack di ${w.levelName || w.folder}`,
      body: h('div', h('.small.muted', { style: { marginBottom: '10px' } }, 'I datapack funzionano su qualsiasi tipo di server, anche Vanilla. Dopo averli aggiunti usa il comando "reload" o riavvia.'), list),
      foot: [btn('Aggiungi .zip…', { cls: 'blue', icon: 'plus', onclick: async () => {
        const files = await run(() => api('dialog:openFile', 'Datapack', [{ name: 'Datapack', extensions: ['zip'] }], true));
        if (!files) return;
        for (const f of files) await run(() => api('worlds:addDatapack', s.id, w.folder, f));
        draw();
        if (isUp(currentServer())) run(() => api('servers:send', s.id, 'reload'));
      } }), btn('Chiudi', { onclick: () => m.close() })],
    });
    draw();
  };

  const card = (w) => {
    const newer = w.version && s.mcVersion && /^\d/.test(w.version) && vcmp(w.version, s.mcVersion) > 0;
    return h('.world-card' + (w.active ? '.active' : ''),
      h('.world-thumb', w.icon ? h('img', { src: w.icon }) : null, w.active ? h('span.tag.green', '● attivo') : null),
      h('.world-body',
        h('.wn', w.levelName || w.folder),
        h('.wm', `Cartella: ${w.folder}`),
        h('.wm', `${w.version ? 'Versione ' + w.version + ' · ' : ''}${fmtBytes(w.size)} · ${fmtAgo(w.lastPlayed)}`),
        newer ? h('.tag.red', { style: { marginTop: '6px', display: 'inline-block' } }, `Creato con una versione più nuova del server (${s.mcVersion})`) : null),
      h('.world-foot',
        !w.active ? btn('Attiva', { cls: 'sm primary', icon: 'check', disabled: running, onclick: async () => { if (await run(() => api('worlds:setActive', s.id, w.folder), 'Mondo attivato')) load(); } }) : null,
        btn('Esporta', { cls: 'sm', icon: 'download', title: 'Esporta in .zip (giocabile in singleplayer)', onclick: () => run(() => api('worlds:export', s.id, w.folder), 'Mondo esportato') }),
        btn('Datapack', { cls: 'sm', icon: 'package', onclick: () => datapacks(w) }),
        !w.active ? btn('', { cls: 'sm ghost icon', icon: 'trash', title: 'Elimina', disabled: running, onclick: async () => {
          if (await confirmBox('Elimina mondo', `"${w.levelName || w.folder}" verrà cancellato definitivamente. Vuoi prima fare un backup? Usa la scheda Backup.`, { okLabel: 'Elimina', danger: true })) {
            if (await run(() => api('worlds:remove', s.id, w.folder), 'Mondo eliminato')) load();
          }
        } }) : null));
  };

  const load = async () => {
    const r = await run(() => api('worlds:list', s.id));
    grid.innerHTML = '';
    if (!r) return;
    if (!r.worlds.length) {
      grid.appendChild(h('.card', { style: { gridColumn: '1 / -1' } }, h('.empty', icon('map'), h('.t', 'Nessun mondo generato'),
        h('div', `Al primo avvio verrà creato "${r.active}". Oppure importane uno esistente.`))));
    }
    r.worlds.forEach((w) => grid.appendChild(card(w)));
  };

  if (running) body.appendChild(h('.locked-note', icon('lock'), 'Il server è acceso: puoi esportare i mondi, ma per importare, attivare o eliminare spegnilo prima.'));
  body.appendChild(h('.row', { style: { marginBottom: '14px' } },
    btn('Importa mondo', { cls: 'primary', icon: 'upload', disabled: running, onclick: importWorld }),
    btn('Nuovo mondo', { icon: 'plus', disabled: running, onclick: newWorld }),
    h('span.grow'),
    btn('Apri cartella', { cls: 'ghost', icon: 'folder', onclick: () => run(() => api('servers:openFolder', s.id, '.')) })));
  if (['paper', 'purpur'].includes(s.type)) body.appendChild(h('.info-note', icon('info'), 'Su Paper/Purpur Nether ed End stanno in cartelle separate (_nether, _the_end): CraftDock le converte in automatico quando importi o esporti un mondo.'));
  body.appendChild(grid);
  load();
}
