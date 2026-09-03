# 🏆 FantaPandy — Private Envelope Auction

A custom fantasy football auction web application built with Next.js, TypeScript, and Tailwind CSS, backed by Supabase and deployed on Vercel. It features a secure commit-reveal bidding mechanism ("CRETINY") and a streamlined administrator dashboard.

## 🚀 Key Features

* **Commit-Reveal Bidding System**: Secure blind bidding process managing participation, sealing, and revealing phases.
* **Auction History & Management**: Real-time tracking of won players, winning amounts, and complete round history.
* **Tie-Breaking Logic**: Automatic detection of absolute ties (total and extra credits) with manual override capabilities for the administrator.
* **Admin Control Panel**: Dedicated dashboard for the auctioneer to control active rounds, close and reveal bids, and manage winners seamlessly.

## 🛠️ Tech Stack

* **Frontend**: Next.js (App Router, Tailwind CSS)
* **Language**: TypeScript
* **Backend / Database**: Supabase (PostgreSQL with Realtime Subscriptions)
* **Hosting & Deployment**: Vercel (https://asta-buste-private.vercel.app)