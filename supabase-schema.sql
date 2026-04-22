-- Supabase Database Schema for SMM Elite
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Wallet Table
CREATE TABLE wallet (
    id INTEGER PRIMARY KEY DEFAULT 1,
    balance NUMERIC(12,2) DEFAULT 15000.00,
    total_funded NUMERIC(12,2) DEFAULT 15000.00,
    total_spent NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users Table
CREATE TABLE users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    referral_code VARCHAR(20) UNIQUE NOT NULL,
    referred_by VARCHAR(50),
    referrals INTEGER DEFAULT 0,
    vip_level INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Orders Table
CREATE TABLE orders (
    id VARCHAR(100) PRIMARY KEY,
    service VARCHAR(50),
    link TEXT,
    quantity INTEGER,
    cost NUMERIC(12,2),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Transactions Table
CREATE TABLE transactions (
    id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'success',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert initial wallet data
INSERT INTO wallet (id, balance, total_funded, total_spent)
VALUES (1, 15000.00, 15000.00, 0)
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Create policies (service role bypasses these)
CREATE POLICY "Service role full access" ON wallet FOR ALL USING (true);
CREATE POLICY "Service role full access" ON users FOR ALL USING (true);
CREATE POLICY "Service role full access" ON orders FOR ALL USING (true);
CREATE POLICY "Service role full access" ON transactions FOR ALL USING (true);

-- Indexes for performance
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_users_email ON users(email);
