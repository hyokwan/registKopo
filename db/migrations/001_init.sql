-- 001_init: 기본 테이블
-- {{p}} 는 테이블 접두어(운영: cb_, 테스트: cb_test_)로 치환된다.
-- MySQL 5.7 호환 문법만 사용한다.

CREATE TABLE IF NOT EXISTS `{{p}}departments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `slug` VARCHAR(50) NOT NULL,
  `default_location` VARCHAR(200) NOT NULL DEFAULT '',
  `telegram_chat_id` VARCHAR(100) NULL,
  `slack_webhook_url` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{{p}}departments_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `{{p}}professors` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `department_id` INT UNSIGNED NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `password_hash` VARCHAR(100) NOT NULL,
  `office` VARCHAR(200) NULL,
  `telegram_chat_id` VARCHAR(100) NULL,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `failed_login_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{{p}}professors_email` (`email`),
  KEY `ix_{{p}}professors_dept` (`department_id`),
  CONSTRAINT `fk_{{p}}professors_dept` FOREIGN KEY (`department_id`) REFERENCES `{{p}}departments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `{{p}}slots` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `professor_id` INT UNSIGNED NOT NULL,
  `start_at` DATETIME NOT NULL,
  `end_at` DATETIME NOT NULL,
  `location` VARCHAR(200) NULL,
  `is_open` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{{p}}slots_prof_start` (`professor_id`, `start_at`),
  KEY `ix_{{p}}slots_start` (`start_at`),
  CONSTRAINT `fk_{{p}}slots_prof` FOREIGN KEY (`professor_id`) REFERENCES `{{p}}professors` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- booked_slot_id: BOOKED일 때만 slot_id, 아니면 NULL → UNIQUE로 "슬롯당 BOOKED 1건"을 DB 차원에서도 보장
CREATE TABLE IF NOT EXISTS `{{p}}reservations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slot_id` INT UNSIGNED NOT NULL,
  `code` CHAR(8) NOT NULL,
  `applicant_name` VARCHAR(50) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `email` VARCHAR(190) NULL,
  `applicant_type` ENUM('고3','재학·졸업생','재직자','전직·전환','기타') NOT NULL,
  `interest` VARCHAR(200) NULL,
  `message` VARCHAR(500) NULL,
  `privacy_agreed` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('BOOKED','CANCELLED','DONE','NO_SHOW') NOT NULL DEFAULT 'BOOKED',
  `cancel_reason` VARCHAR(200) NULL,
  `cancelled_by` ENUM('APPLICANT','PROFESSOR') NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME NULL,
  `anonymized_at` DATETIME NULL,
  `booked_slot_id` INT UNSIGNED GENERATED ALWAYS AS (IF(`status` = 'BOOKED', `slot_id`, NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{{p}}reservations_code` (`code`),
  UNIQUE KEY `uq_{{p}}reservations_booked` (`booked_slot_id`),
  KEY `ix_{{p}}reservations_slot` (`slot_id`),
  KEY `ix_{{p}}reservations_phone` (`phone`),
  CONSTRAINT `fk_{{p}}reservations_slot` FOREIGN KEY (`slot_id`) REFERENCES `{{p}}slots` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- express-mysql-session 기본 스키마와 동일
CREATE TABLE IF NOT EXISTS `{{p}}sessions` (
  `session_id` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` INT(11) UNSIGNED NOT NULL,
  `data` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
