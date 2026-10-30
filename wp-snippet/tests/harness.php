<?php
define('ABSPATH','/'); define('FSA_V2_ASSETS','inline'); // the test pages are opened as files, so style and script stay inside them
$GLOBALS['sc']=null;
function add_action(...$a){} function add_filter(...$a){}
function add_shortcode($n,$f){if($n==='fs_account_v2')$GLOBALS['sc']=$f;}
function admin_url($p=''){return 'https://site.test/wp-admin/'.$p;} function home_url($p=''){return 'https://site.test'.$p;}
function current_user_can($c){return true;} function is_user_logged_in(){return true;} function wp_get_current_user(){return (object)['user_login'=>'admin'];}
function wp_json_encode($d,$f=0){return json_encode($d,$f);}
function fsa_v2_data_stub(){return json_decode(file_get_contents(__DIR__.'/fsdata.json'),true);}
$src=file_get_contents($argv[1]);
$src=str_replace('wp_json_encode( fsa_v2_data(),','wp_json_encode( fsa_v2_data_stub(),',$src);
eval($src);
echo ($GLOBALS['sc'])();
