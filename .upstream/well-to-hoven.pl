#!/usr/bin/perl
# Rewrites a Well (leen-saz/well-ads) patch for Hoven: names, buckets, cookies, owner, brand colours and fonts.
# Run on unified diff text only (no binary hunks). Arabic word boundaries: never touch letters inside a word.
use strict; use warnings; use utf8;
binmode STDIN, ':encoding(UTF-8)'; binmode STDOUT, ':encoding(UTF-8)';
my $A = '\x{0600}-\x{06FF}';
my @plain = (
  ['leen.sulaiman@wellunion.co','leen@brandsforhome.sa'], ['leen-saz/well-ads-dashboard','leen-saz/hoven-dashboard'],
  ['leen-saz/well-ads','leen-saz/hoven'], ['well-ads-files','hoven-files'], ['well-ads-staging','hoven-staging'],
  ['well-ads.pages.dev','hoven.pages.dev'], ['projects/well-ads','projects/hoven'], ['pages project create well-ads','pages project create hoven'],
  ['grep -qw well-ads','grep -qw hoven'], ['well-ads-lang','hoven-lang'], ['well-ads-target','hoven-target'], ['well-ads-ui','hoven-ui'],
  ['well-ads-cron','hoven-cron'], ['well-db-backup-','hoven-db-backup-'], ['well-ads_','hoven_'], ['"well-ads"','"hoven"'], ["'well-ads'","'hoven'"],
  ['__Host-well_session','__Host-hoven_session'], ['__Secure-well_oauth','__Secure-hoven_oauth'], ["'well-me'","'hoven-me'"],
  ['WellAdsDashboard','HovenDashboard'], ['WELL Pixel (7655684600528846866)','بكسل هوفن (من صفحة الربط)'], ['WELL PIXEL','بكسل هوفن (من صفحة الربط)'], ['well-ads-dashboard.html','hoven-dashboard.html'], ['\'well-me-2\'','\'hoven-me-2\''], ['download="well-','download="hoven-'], ['well-ads-refresh','hoven-refresh'], ['tiktok.com/@well/','tiktok.com/@hoven.gcc/'], ['https://well.example','https://hoven.example'], ['https://well.test','https://hoven.test'], ['وزارة الصحة','حماية المستهلك'], ['well-ads-listening','hoven-listening'], ['well-listen-kw','hoven-listen-kw'], ['هوفن للرعاية المنزلية، well care','هوفن، hoven، مفارش هوفن'], ['https://wellcare.sa','https://hoven.sa'], ['wellcare.sa','hoven.sa'], ['متابعة طلب المحاليل','متابعة طلب جديد'], ['@wellcare.sa','@hoven.gcc'], ['WellContentAgent','HovenContentAgent'], ['"name": "journey-run','"name": "hoven-journey-run'],
  ['thmanyahsans-Regular','ibmplexsansarabic-regular'], ['thmanyahsans-Medium','ibmplexsansarabic-medium'], ['thmanyahsans-Bold','ibmplexsansarabic-bold'],
  ['thmanyahseriftext-Regular','ibmplexsansarabic-regular'], ['thmanyahseriftext-Medium','ibmplexsansarabic-medium'], ['thmanyahseriftext-Bold','ibmplexsansarabic-bold'],
  ['thmanyahserifdisplay-Bold','hoven-brand'], ['thmanyahserifdisplay-Black','hoven-brand'],
  ['"Thmanyah Display"','"Hoven Brand"'], ['"Thmanyah Serif"','"Plex"'], ['"Thmanyah Sans"','"Plex"'], ['"Playfair Display"','"Hoven Brand"'],
  ['126,87,253','41,64,54'], ['29,16,105','41,51,66'], ['34,17,150','20,20,20'], ['172,166,225','127,181,154'], ['248,96,128','179,38,30'],
);
my @hex = (['1D1069','293342'], ['7E57FD','294036'], ['221196','141414'], ['ACA6E1','7fb59a'], ['F6F0E3','F2F0E3'], ['F86080','B3261E']);
while (my $l = <STDIN>) {
  if ($l =~ /^(diff --git|index |--- |\+\+\+ |@@ )/) { print $l; next; }   # never rewrite paths or hunk headers
  for my $p (@plain) { my ($a, $b) = @$p; $l =~ s/\Q$a\E/$b/g; }
  for my $h (@hex) { my ($a, $b) = @$h; $l =~ s/$a/$b/gi; }
  $l =~ s/(?<![A-Za-z_])Well(?![A-Za-z_])/Hoven/g;
  $l =~ s/(?<![$A])(?:وِل|ويل)(?![$A])/هوفن/g;
  print $l;
}
