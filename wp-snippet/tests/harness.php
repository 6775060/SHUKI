<?php
define('ABSPATH','/');
$GLOBALS['sc']=null;
function add_action(...$a){} function add_filter(...$a){}
function add_shortcode($n,$f){$GLOBALS['sc']=$f;}
function current_user_can($c){return true;}
function wp_json_encode($d,$f=0){return json_encode($d,$f);}
function fsa_v2_data_stub(){return json_decode(file_get_contents(__DIR__.'/fsdata.json'),true);}
$src=file_get_contents($argv[1]);
$src=str_replace('wp_json_encode( fsa_v2_data(),','wp_json_encode( fsa_v2_data_stub(),',$src);
eval($src);
echo ($GLOBALS['sc'])();
