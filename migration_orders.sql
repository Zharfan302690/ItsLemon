-- It's Lemon: pesanan online + rekap. Jalankan sekali di Supabase > SQL Editor > New query > Run.
-- Aman dijalankan ulang (idempotent). Tidak mengubah tabel yang sudah ada.

create sequence if not exists public.order_code_seq start 1001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_name text not null check (char_length(customer_name) between 1 and 60),
  customer_contact text check (customer_contact is null or char_length(customer_contact) <= 40),
  notes text check (notes is null or char_length(notes) <= 300),
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  total_amount integer not null default 0,
  transaction_id uuid references public.transactions(id),
  handled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price integer not null
);

create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists orders_transaction_idx on public.orders (transaction_id);

-- Semua akses lewat API server (service role); kunci tabel dari akses publik.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Pelanggan membuat pesanan. Stok hanya dicek di sini; stok baru dikurangi saat kasir menyelesaikan pesanan.
create or replace function public.place_order(p_name text, p_contact text, p_notes text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb; prod public.products%rowtype; qty int; total int := 0;
  ord public.orders%rowtype; seen uuid[] := '{}'; pid uuid;
begin
  if p_name is null or char_length(btrim(p_name)) = 0 then raise exception 'Nama wajib diisi'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Keranjang kosong'; end if;
  if (select count(*) from orders where status = 'pending') >= 100 then raise exception 'Terlalu banyak pesanan menunggu. Coba lagi sebentar lagi'; end if;

  insert into orders(code, customer_name, customer_contact, notes)
    values ('L' || nextval('order_code_seq'), left(btrim(p_name), 60), nullif(left(btrim(coalesce(p_contact,'')), 40), ''), nullif(left(btrim(coalesce(p_notes,'')), 300), ''))
    returning * into ord;

  for it in select * from jsonb_array_elements(p_items) loop
    pid := (it->>'product_id')::uuid;
    qty := (it->>'quantity')::int;
    if qty is null or qty < 1 or qty > 20 then raise exception 'Jumlah tidak valid'; end if;
    if pid = any(seen) then raise exception 'Produk dobel di keranjang'; end if;
    seen := seen || pid;
    select * into prod from products where id = pid;
    if not found then raise exception 'Produk tidak ditemukan'; end if;
    if not prod.active then raise exception 'Produk % tidak aktif', prod.name; end if;
    if prod.price <= 0 then raise exception 'Harga % belum diatur', prod.name; end if;
    if prod.stock < qty then raise exception 'Stok tidak cukup untuk %', prod.name; end if;
    insert into order_items(order_id, product_id, product_name, quantity, unit_price)
      values (ord.id, prod.id, prod.name, qty, prod.price);
    total := total + prod.price * qty;
  end loop;

  update orders set total_amount = total where id = ord.id returning * into ord;
  return jsonb_build_object('id', ord.id, 'code', ord.code, 'total_amount', ord.total_amount);
end $$;
revoke all on function public.place_order(text, text, text, jsonb) from public, anon, authenticated;

-- Kasir menyelesaikan pesanan: stok dikurangi, transaksi tercatat, pesanan ditutup (satu transaksi database).
create or replace function public.complete_order(p_order_id uuid, p_cashier_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ord public.orders%rowtype; items jsonb; tx jsonb;
begin
  select * into ord from orders where id = p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if ord.status <> 'pending' then raise exception 'Pesanan sudah diproses'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity)) into items
    from order_items where order_id = ord.id and product_id is not null;
  if items is null then raise exception 'Keranjang kosong'; end if;
  tx := process_sale(items, p_cashier_id,
    left('Pesanan ' || ord.code || ' - ' || ord.customer_name || coalesce(' | ' || ord.notes, ''), 500));
  update orders set status = 'completed', transaction_id = (tx->>'id')::uuid,
    handled_by = p_cashier_id, handled_at = now(), total_amount = (tx->>'total_amount')::int
    where id = ord.id;
  return tx;
end $$;
revoke all on function public.complete_order(uuid, uuid) from public, anon, authenticated;
