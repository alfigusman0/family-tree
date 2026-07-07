<?php
require __DIR__ . '/config.php';

if (current_user()) {
    header('Location: dashboard.php');
} else {
    header('Location: login.php');
}
exit;
