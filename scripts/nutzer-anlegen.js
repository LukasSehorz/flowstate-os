#!/usr/bin/env node
// Legt die fuenf CRM-Nutzer an (Supabase Auth + profiles mit Rolle).
// Idempotent: vorhandene Nutzer werden uebersprungen.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const envPfad = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPfad)) {
  for (const zeile of fs.readFileSync(envPfad, "utf-8").split("\n")) {
    const t = zeile.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const START_PASSWORT = process.argv[2] || "flowstate2026";

const NUTZER = [
  { email: "lukas.sehorz@flowstate-ai.net",  name: "Lukas Sehorz",    rolle: "admin" },
  { email: "jannikvomhofe@flowstate-ai.net", name: "Jannik vom Hofe", rolle: "admin" },
  { email: "louis.tournier@flowstate-ai.net", name: "Louis Tournier", rolle: "mitarbeiter" },
  { email: "ioannis@flowstate-ai.net",       name: "Ioannis",         rolle: "mitarbeiter" },
  { email: "simon@flowstate-ai.net",         name: "Simon",           rolle: "mitarbeiter" },
];

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("create extension if not exists pgcrypto");

  for (const n of NUTZER) {
    const da = await client.query("select id from auth.users where email = $1", [n.email]);
    if (da.rows.length) {
      // Rolle/Name im Profil aktualisieren, Passwort neu setzen
      await client.query(
        `update auth.users set encrypted_password = crypt($2, gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()) where email = $1`,
        [n.email, START_PASSWORT]
      );
      await client.query(
        `insert into public.profiles (id, name, rolle) values ($1,$2,$3)
         on conflict (id) do update set name = excluded.name, rolle = excluded.rolle`,
        [da.rows[0].id, n.name, n.rolle]
      );
      console.log(`↻ ${n.email.padEnd(34)} ${n.rolle.padEnd(12)} (aktualisiert)`);
      continue;
    }

    const { rows } = await client.query(
      `insert into auth.users
        (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         $1, crypt($2, gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, $3::jsonb)
       returning id`,
      [n.email, START_PASSWORT, JSON.stringify({ name: n.name, rolle: n.rolle })]
    );
    const id = rows[0].id;

    await client.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values ($1::text, $2::uuid, $3::jsonb, 'email', now(), now(), now())
       on conflict do nothing`,
      [id, id, JSON.stringify({ sub: id, email: n.email, email_verified: true, phone_verified: false })]
    );

    await client.query(
      `insert into public.profiles (id, name, rolle) values ($1,$2,$3)
       on conflict (id) do update set name = excluded.name, rolle = excluded.rolle`,
      [id, n.name, n.rolle]
    );
    console.log(`✅ ${n.email.padEnd(34)} ${n.rolle.padEnd(12)} angelegt`);
  }

  const p = await client.query("select name, rolle from public.profiles order by rolle, name");
  console.log(`\n👥 Im CRM: ${p.rows.map((r) => `${r.name} (${r.rolle})`).join(" · ")}`);
  console.log(`🔑 Startpasswort für alle: ${START_PASSWORT}`);
  await client.end();
})().catch((e) => { console.error("❌ Fehler:", e.message); process.exit(1); });
