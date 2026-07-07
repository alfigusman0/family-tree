-- Family Tree — skema database
-- Jalankan: mysql -h <host> -u <user> -p family_tree < database/schema.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trees (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  description TEXT NULL,
  owner_id    INT UNSIGNED NOT NULL,
  -- kode share: siapa pun yang punya kode bisa bergabung sesuai perannya
  share_code_edit VARCHAR(20) NOT NULL UNIQUE,
  share_code_view VARCHAR(20) NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_trees_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tree_members (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tree_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  role       ENUM('owner','editor','viewer') NOT NULL DEFAULT 'editor',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tree_user (tree_id, user_id),
  CONSTRAINT fk_tm_tree FOREIGN KEY (tree_id) REFERENCES trees(id) ON DELETE CASCADE,
  CONSTRAINT fk_tm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS persons (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tree_id     INT UNSIGNED NOT NULL,
  full_name   VARCHAR(150) NOT NULL,
  nickname    VARCHAR(80) NULL,
  gender      ENUM('L','P') NOT NULL,          -- L = laki-laki, P = perempuan
  nik         VARCHAR(20) NULL,
  birth_place VARCHAR(120) NULL,
  birth_date  DATE NULL,
  birth_order TINYINT UNSIGNED NULL,             -- anak ke-berapa (urutan manual)
  death_date  DATE NULL,
  is_deceased TINYINT(1) NOT NULL DEFAULT 0,
  photo       VARCHAR(255) NULL,
  -- relasi orang tua: mendukung poligami secara alami — anak dari ibu yang sama
  -- bisa punya father_id berbeda (ibu menikah lebih dari satu kali), dan sebaliknya
  father_id   INT UNSIGNED NULL,
  mother_id   INT UNSIGNED NULL,
  notes       TEXT NULL,
  created_by  INT UNSIGNED NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_persons_tree (tree_id),
  CONSTRAINT fk_p_tree   FOREIGN KEY (tree_id)   REFERENCES trees(id)   ON DELETE CASCADE,
  CONSTRAINT fk_p_father FOREIGN KEY (father_id) REFERENCES persons(id) ON DELETE SET NULL,
  CONSTRAINT fk_p_mother FOREIGN KEY (mother_id) REFERENCES persons(id) ON DELETE SET NULL,
  CONSTRAINT fk_p_user   FOREIGN KEY (created_by) REFERENCES users(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pernikahan: satu orang boleh muncul di banyak baris (poligami / menikah lagi).
CREATE TABLE IF NOT EXISTS marriages (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tree_id       INT UNSIGNED NOT NULL,
  husband_id    INT UNSIGNED NOT NULL,
  wife_id       INT UNSIGNED NOT NULL,
  marriage_date DATE NULL,
  divorce_date  DATE NULL,
  status        ENUM('married','divorced','widowed') NOT NULL DEFAULT 'married',
  marriage_order TINYINT UNSIGNED NOT NULL DEFAULT 1, -- urutan pernikahan (istri ke-1, ke-2, ...)
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_couple (husband_id, wife_id),
  KEY idx_m_tree (tree_id),
  CONSTRAINT fk_m_tree    FOREIGN KEY (tree_id)    REFERENCES trees(id)   ON DELETE CASCADE,
  CONSTRAINT fk_m_husband FOREIGN KEY (husband_id) REFERENCES persons(id) ON DELETE CASCADE,
  CONSTRAINT fk_m_wife    FOREIGN KEY (wife_id)    REFERENCES persons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tautan tamu: lihat pohon tanpa login, dengan masa berlaku
CREATE TABLE IF NOT EXISTS share_links (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tree_id    INT UNSIGNED NOT NULL,
  token      VARCHAR(40) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sl_tree FOREIGN KEY (tree_id) REFERENCES trees(id) ON DELETE CASCADE,
  CONSTRAINT fk_sl_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Log aktivitas untuk kolaborasi ("siapa mengubah apa")
CREATE TABLE IF NOT EXISTS activities (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tree_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NULL,
  action     VARCHAR(40) NOT NULL,   -- person_add, person_edit, person_delete, marriage_add, import_kk, ...
  detail     VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_a_tree (tree_id, created_at),
  CONSTRAINT fk_a_tree FOREIGN KEY (tree_id) REFERENCES trees(id) ON DELETE CASCADE,
  CONSTRAINT fk_a_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
