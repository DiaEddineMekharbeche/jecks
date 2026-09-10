import type { Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import { ContactForm } from '@/components/contact-form';
import { getDictionary } from '@/lib/dictionary';

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  const dictionary = getDictionary(params.locale as Locale);
  return { title: dictionary.contact.title };
}

export default function ContactPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  return (
    <div className="shell py-16">
      <ContactForm dictionary={getDictionary(locale)} />
    </div>
  );
}
