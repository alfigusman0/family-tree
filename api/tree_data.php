<?php
/**
 * GET ?tree_id=..  →  seluruh data pohon (persons + marriages) untuk dirender.
 */
require __DIR__ . '/../config.php';

$user   = api_user();
$treeId = (int) ($_GET['tree_id'] ?? 0);
$role   = require_tree_access($treeId, (int) $user['id']);

$st = db()->prepare(
    'SELECT id, full_name, nickname, gender, nik, birth_place, birth_date, birth_order,
            death_date, is_deceased, photo, father_id, mother_id, notes
     FROM persons WHERE tree_id = ? ORDER BY birth_date IS NULL, birth_date, id'
);
$st->execute([$treeId]);
$persons = $st->fetchAll();

$st = db()->prepare(
    'SELECT id, husband_id, wife_id, marriage_date, divorce_date, status, marriage_order
     FROM marriages WHERE tree_id = ? ORDER BY marriage_order, id'
);
$st->execute([$treeId]);
$marriages = $st->fetchAll();

json_out([
    'ok'        => true,
    'role'      => $role,
    'persons'   => $persons,
    'marriages' => $marriages,
]);
